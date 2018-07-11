var loopback = require('loopback');
var JobRunner = loopback.getModelByType('JobRunner');
var Job = loopback.getModelByType('Job');
var request = require('request');

var log = require('oe-logger')('jobScheduler');
var TAG = 'JOB_SCHEDULER: ';
var runners;
var currentRunner = -1;
var RUNNER_UPDATE_INTERVAL = 360000;
var SCHEDULE_NEW_JOBS_INTERVAL = 30000;
var JOB_TRIGGER_FAIL_RETRY_INTERVAL = 15000;
var options = {
    ignoreAutoScope: true,
    fetchAllScopes: true
};
var firstSchedule = true;

function start() {
    startScheduler();
}

function stop() {
    log.info(TAG, 'Stopping Job Scheduler...');
}

module.exports = {
    start: start,
    stop: stop
}


function startScheduler() {
    startUpdateRunners();
    log.info(TAG, 'Starting Job Scheduler...');

    scheduleJobs();
    setInterval(scheduleJobs, SCHEDULE_NEW_JOBS_INTERVAL);

    function scheduleJobs() {
        var filter = {where: {scheduled: false}};
        if(firstSchedule) {
            filter = {};
            firstSchedule = false;
        }
        Job.find(filter, options, function findCb(err, jobs) {         
            if (!err && jobs && jobs.length > 0) {                                                   
                jobs.forEach(function(job) {
                    var f = function() {
                        var runner = getRunner();
                        if(runner) {
                            log.info(TAG, job.jobID + ' triggered on ' + runner.hostname + ':' + runner.port);
                            job['attemptNo'] = 0; 
                            triggerJobOnRunner(job, runner); 
                        } else {
                            log.warn(TAG, 'No runner to execute '+ job.jobID +'. Have to retry'); 
                        }  
                    };
                    setInterval(f, job.interval);
                    job.updateAttributes({scheduled: true}, options, function (err, results) {
                        if (!err && results) {
                            log.info(TAG, 'Scheduled new Job '+ job.jobID);
                        } else {
                            log.warn(TAG, 'Could not update scheduled status for Job '+ job.jobID);
                        }
                    });
                });
                log.info(TAG, 'No. of (new) Jobs Scheduled: ' + jobs.length);             
            } else {
                log.info(TAG, 'No (new) Jobs found');
            }
        });
    }
    
//    var jobs = [{jobID: 'JOB1', interval: 10000}, {jobID: 'JOB2', interval: 15000}, {jobID: 'JOB3', interval: 20000}];
}


function getRunner() {
    if(runners && runners.length > 0) {
        var nextRunner = ++currentRunner;
        if(nextRunner > runners.length - 1) { nextRunner = 0; currentRunner = 0; }
        return runners[nextRunner];
    } else {
        return null;
    }
}

function startUpdateRunners() {
    updateRunners();
    setInterval( updateRunners, RUNNER_UPDATE_INTERVAL); 
}

function updateRunners() {
    JobRunner.find({}, options, function findCb(err, allRunners) {         
        if (!err && allRunners) {                                                   
            runners = allRunners;
        } else {
            log.warn(TAG, 'No active job-runners were found for updating runner list');
        }
    });
}

function triggerJobOnRunner(job, rnr) {
    var url = 'http://' + rnr.hostname +  ':' + rnr.port + '/api/JobRunners/runJob/' + job.jobID;
    request(url, function (error, response, body) {
        if(error) console.error(TAG, JSON.stringify(error)); 
        if(error || (response && response.statusCode !== 200)) {
            log.warn(TAG, 'Could not trigger ' + job.jobID + ' on runner ' + rnr.hostname +  ':' + rnr.port);
            log.warn(TAG, 'Will Retry '+ job.jobID +' after ' + JOB_TRIGGER_FAIL_RETRY_INTERVAL/1000 + ' sec');
            
            setTimeout(function() {
                var newRunner = getRunner();
                if(newRunner) {
                    var attemptNo = job['attemptNo'] || 0;
                    log.info(TAG, 'Retrying ' + job.jobID + ' attempt #' + ++attemptNo);
                    job['attemptNo'] = attemptNo;
                    triggerJobOnRunner(job, newRunner);
                } else {
                    log.error(TAG, 'No runner available to retry ' + job.jobID);
                }
            }, JOB_TRIGGER_FAIL_RETRY_INTERVAL);


        } else {
            log.info(TAG, job.jobID + ' triggered on runner ' + rnr.hostname +  ':' + rnr.port + ' (' + response.statusCode + ')');
        }
    });
}

