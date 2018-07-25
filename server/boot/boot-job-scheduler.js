var loopback = require('loopback');
var uuidv4 = require('uuid/v4');
var os = require('os');
var hostname = os.hostname();
var myInstanceID = uuidv4();
var port;
var log = require('oe-logger')('bootJobScheduler');
var masterJobExecutor = require('oe-master-job-executor');
var masterJob = require('../../lib/jobScheduler.js');
var TAG = 'BOOT-JOB-SCHEDULER: ';
var JobRunner = loopback.getModelByType('JobRunner');
var options = {
    ignoreAutoScope: true,
    fetchAllScopes: true
};
var config;
var confPath = '../../../oe-cloud/server/config.js';
try {
    config = require(confPath).jobScheduler;
} catch(e) { log.warn(TAG, e.message); }

var JR_HEARTBEAT_INTERVAL = process.env.JOB_RUNNER_HEARTBEAT_INTERVAL || config && config.runnerHeartbeatInterval || 20000;
var JR_TOLERANCE = JR_HEARTBEAT_INTERVAL * 3;
var JR_CLEANUP_INTERVAL = process.env.JOB_RUNNER_CLEANUP_INTERVAL || config && config.runnerCleanupInterval || 15000;
var JR_RETRY_INTERVAL = process.env.JOB_RUNNER_RETRY_INTERVAL || config && config.runnerRetryInterval || 60000;
var JR_MAX_HEARTBEAT_RETRY_COUNT = process.env.JOB_RUNNER_MAX_HEARTBEAT_RETRY_COUNT || config && config.runnerMaxHeartbeatRetryCount || 3;

module.exports = function startJobScheduler(server, callback) {
    
    port = server.get('port');

    deleteStaleRunners();
    setInterval(deleteStaleRunners, JR_CLEANUP_INTERVAL);

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
        log.warn(TAG, 'Not a Job Runner (process.env.IS_JOB_RUNNER !== true)');
    }

    callback();
};


function becomeRunner() {
    log.debug(TAG, 'Trying to become JobRunner');
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
            log.warn(TAG, 'Could not create JobRunner record. Will try again in ' + JR_RETRY_INTERVAL/1000 + ' sec');
            setTimeout(becomeRunner, JR_RETRY_INTERVAL);
        }
    });
}


function startHeartbeat(jobRunner) {
    var retries = 0;
    log.debug(TAG, 'Starting JobRunner '+ hostname + ':' + port +' Heartbeat...');
    var hb = setInterval(function () {
        jobRunner.updateAttributes({
            heartbeatTime: Date.now()
        }, options, function (err, results) {
            if (!err && results) {
                retries = 0;
                log.debug(TAG, 'Updated JobRunner '+ hostname + ':' + port +' Heartbeat ' + results.heartbeatTime);
            } else {
                if(++retries > JR_MAX_HEARTBEAT_RETRY_COUNT) {
                    clearInterval(hb); 
                    log.warn(TAG, 'Could not update JobRunner '+ hostname + ':' + port +' Heartbeat.');
                    becomeRunner();
                } else {
                    log.warn(TAG, 'Could not update JobRunner '+ hostname + ':' + port +' Heartbeat. Will retry (#'+ retries +') in ' + JR_HEARTBEAT_INTERVAL/1000 + ' sec');
                }
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
                    log.debug(TAG, 'Deleted Stale Runner ' + staleRunner.hostname + ':' + staleRunner.port + ' ('+ staleRunner.id +')');
                });
            });      
        }
    });
}