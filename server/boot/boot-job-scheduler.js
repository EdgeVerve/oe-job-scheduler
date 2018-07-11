var loopback = require('loopback');
var uuidv4 = require('uuid/v4');
var os = require('os');
var hostname = os.hostname();
var myInstanceID = uuidv4();
var port;
var log = require('oe-logger')('job-scheduler.boot');
var masterJobExecutor = require('../../../oe-master-job-executor/lib/master-job-executor');
var masterJob = require('../../lib/jobScheduler.js');
var TAG = 'BOOT-JOB-SCHEDULER: ';
var JobRunner = loopback.getModelByType('JobRunner');
var options = {
    ignoreAutoScope: true,
    fetchAllScopes: true
};
var JR_HEARTBEAT_INTERVAL = 20000;
var JR_TOLERANCE = 25000;
var JR_STALE_INTERVAL = 360000;
var BECOME_RUNNER_RETRY_INTERVAL = 60000;

module.exports = function startJobScheduler(server, callback) {
    port = server.get('port');

    deleteStaleRunners();
    setInterval(deleteStaleRunners, JR_STALE_INTERVAL);

    if(process.env.IS_JOB_RUNNER && (process.env.IS_JOB_RUNNER ==='true' || process.env.IS_JOB_RUNNER ==='TRUE')) {
        becomeRunner();
        log.info(TAG, 'Starting JobScheduler Service');
        var options = {
            lockName: 'JOB-SCHEDULER',
            masterJob: masterJob,
            initDelay: 20000,
            tolerance: 10000,
            heartbeatInterval: 8000
        };
        masterJobExecutor(options);
    } else {
        log.info(TAG, 'Not a Job Runner (process.env.IS_JOB_RUNNER !== true)');
    }

    callback();
};


function becomeRunner() {
    var data = {
        hostname: hostname,
        port: port,
        instanceID: myInstanceID,
        heartbeatTime: Date.now()
    };
    JobRunner.create(data, options, function createCb(err, res) {
        if (!err && res && res.id) {
            log.info(TAG, 'I am a JobRunner (' + hostname + ':' + port + ')');
            startHeartbeat(res);
        } else {
            log.warn(TAG, 'Could not create JobRunner record. Will try again in ' + BECOME_RUNNER_RETRY_INTERVAL/1000 + ' sec');
            setTimeout(becomeRunner, BECOME_RUNNER_RETRY_INTERVAL);
        }
    });
}


function startHeartbeat(lock) {
    log.info(TAG, 'Starting JobRunner '+ hostname + ':' + port +' Heartbeat...');
    var hb = setInterval(function () {
        lock.updateAttributes({
            heartbeatTime: Date.now()
        }, options, function (err, results) {
            if (!err && results) {
                log.debug(TAG, 'Updated JobRunner '+ hostname + ':' + port +' Heartbeat ' + results.heartbeatTime);
            } else {
                clearInterval(hb); 
                log.warn(TAG, 'Could not update JobRunner '+ hostname + ':' + port +' Heartbeat.');
                log.info(TAG, 'Trying to become JobRunner');
                becomeRunner();
            }
        });
    }, JR_HEARTBEAT_INTERVAL);
}


function deleteStaleRunners() {
    var filter = {
        where: {
            heartbeatTime: {lt: (Date.now() - JR_TOLERANCE) }
        }
    };
    JobRunner.find(filter, options, function findCb(err, staleRunners) {         
        if (!err && staleRunners) {                                                   
            staleRunners.forEach(function(staleRunner) {
                staleRunner.delete(options, function (err, res) {                        
                    log.info(TAG, 'Deleted Stale Runner ' + staleRunner.hostname + ':' + staleRunner.port + ' ('+ staleRunner.id +')');
                });
            });      
        }
    });
}