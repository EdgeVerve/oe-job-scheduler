var loopback = require('loopback');
var JobRunner = loopback.getModelByType('JobRunner');
var JobExecution = loopback.getModelByType('JobExecution');
var Job = loopback.getModelByType('Job');
var request = require('request');
var uuidv4 = require('uuid/v4');

var log = require('oe-logger')('jobScheduler');
var TAG = 'JOB_SCHEDULER: ';
var runners;
var currentRunner = -1;
var RUNNER_UPDATE_INTERVAL = 15000;
var SCHEDULE_NEW_JOBS_INTERVAL = 30000;
var SCHEDULE_DEFUNCT_JOBS_INTERVAL = 30000;
var JOB_TRIGGER_FAIL_RETRY_INTERVAL = 5000;
var DEFUNCT_TOLERANCE = 300000;
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
    log.info(TAG, 'Starting Job Scheduler...');

    updateRunners();
    setInterval( updateRunners, RUNNER_UPDATE_INTERVAL); 

    retryDefunctJobs();
    setInterval(retryDefunctJobs, SCHEDULE_DEFUNCT_JOBS_INTERVAL);

    scheduleJobs();
    setInterval(scheduleJobs, SCHEDULE_NEW_JOBS_INTERVAL);
    
}

function scheduleJobs() {
    var filter = {where: {enabled: true, scheduled: false}};
    if(firstSchedule) {
        filter = {where: {enabled: true}};
        firstSchedule = false;
    }
    Job.find(filter, options, function findCb(err, jobs) {
        if(err) log.error(TAG, 'Could not fetch jobs for scheduling. ' + JSON.stringify(err));         
        else if(jobs && jobs.length > 0) {                                                   
            jobs.forEach(function(job) {
                
                var f = function() {
                    var executionID = uuidv4();
                    var execID = executionID.substring(30);
                    var now = Date.now();
                    var execJob = {
                        executionID: executionID,
                        execID: execID,
                        jobID: job.jobID,
                        mdl: job.mdl,
                        fn: job.fn,
                        interval: job.interval,
                        enabled: job.enabled,
                        maxRetryAttempts: job.maxRetryAttempts,
                        attemptNo : job.attemptNo,
                        retryEnabled: job.retryEnabled,
                        scheduleTime: now,
                        lastUpdateTime: now,
                        state: 'CREATED'
                    };
                    JobExecution.create(execJob, options, function(err, jobExec) {
                        if(err || !jobExec) log.error(TAG, 'Could not create JobExecution record for ' + job.jobID + '-' + execID);
                        else {
                            triggerJob(jobExec, function(err) {
                                if(err) log.error(TAG, err && err.message ? err.message : JSON.stringify(err));  //  shutdown scheduler and/or running jobs here?
                            });
                        }
                    });
                     
                };

                // actual scheduling -- need to use library here
                setInterval(f, job.interval);
                
                
                job.updateAttributes({scheduled: true}, options, function (err, results) {
                    if (!err && results) {
                        log.info(TAG, 'Scheduled new Job '+ job.jobID);
                    } else {
                        log.error(TAG, 'Could not update scheduled status for Job '+ job.jobID);
                    }
                });
            });
            log.info(TAG, 'No. of (new) Jobs Scheduled: ' + jobs.length);             
        } else {
            log.info(TAG, 'No (new) Jobs found');
        }
    });
}


function retryDefunctJobs() {
    var filter = {where: {and: [{state: {neq: 'COMPLETED'}}, {state: {neq: 'FAILED'}}]}};
    JobExecution.find(filter, options, function findCb(err, jobExecs) {
        if(err) log.error(TAG, 'Could not fetch jobExecs for triggering. ' + JSON.stringify(err));         
        else if(jobExecs && jobExecs.length > 0) {
            var reTrigCount = 0;
            jobExecs.forEach(function(jobExec) {
                console.log(TAG, 'jobExec.lastUpdateTime        : ' + jobExec.lastUpdateTime + '  ' + jobExec.state);
                console.log(TAG, 'Date.now()                    : ' + Date.now());
                console.log(TAG, 'DEFUNCT_TOLERANCE             : ' + DEFUNCT_TOLERANCE);
                console.log(TAG, 'Date.now() - DEFUNCT_TOLERANCE: ' + (Date.now() - DEFUNCT_TOLERANCE));
                console.log(TAG, 'jobExec.retryEnabled          : ' + jobExec.retryEnabled);
                if((jobExec.lastUpdateTime < (Date.now() - DEFUNCT_TOLERANCE))) {
                    if(jobExec.retryEnabled === true) {
                        reTrigCount++;
                        log.info(TAG, 'Re-triggering Job ' + jobExec.jobID + '-' + jobExec.execID);
                        triggerJob(jobExec, function(err) {
                            if(err) log.error(TAG, err && err.message ? err.message : JSON.stringify(err));  //  shutdown scheduler and/or running jobs here?
                        });
                    } else {
                    log.info(TAG, 'Marking as FAILED Job ' + jobExec.jobID + '-' + jobExec.execID);
                        jobExec.updateAttributes({state: 'FAILED', lastUpdateTime: Date.now()}, options, function (err, results) {
                            if (!err && results) {
                                log.error(TAG, 'Job '+ jobExec.jobID + '-' + jobExec.execID + ' marked as FAILED (retryDefunctJobs)');
                            } else {
                                log.error(TAG, 'Could not mark Job '+ jobExec.jobID + '-' + jobExec.execID + ' as FAILED ' + err? JSON.stringify(err): '');
                            }
                        });
                    }
                }
            });
            log.info(TAG, 'Found ' + reTrigCount + ' JobExecs for retriggering');                                                   
        }
    });
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


function updateRunners() {
    JobRunner.find({}, options, function findCb(err, allRunners) {         
        if (!err && allRunners) {                                                   
            runners = allRunners;
        } else {
            log.warn(TAG, 'No active job-runners were found for updating runner list');
        }
    });
}

function triggerJob(execJob, cb) {
    var runner = getRunner();
    if(!runner) {
        log.warn(TAG, 'No runner to execute '+ execJob.jobID + '-' + execJob.execID);
        retryJob(execJob, cb); 
        return cb(new Error('No runner to execute '+ execJob.jobID + '-' + execJob.execID));
    } 
//    log.info(TAG, job.jobID + '-' + job.execID + ' triggering on ' + runner.hostname + ':' + runner.port);

    var url = 'http://' + runner.hostname +  ':' + runner.port + '/api/JobRunners/runJob/' + execJob.jobID + '/' +  execJob.executionID;
    request(url, function (error, response, body) {
        if(error) log.error(TAG, execJob.jobID + '-' + execJob.execID + ' trigger: ' + JSON.stringify(error)); 
        if(error || (response && response.statusCode !== 200)) {
            log.warn(TAG, execJob.jobID + '-' + execJob.execID + ' could not be triggered on runner ' + runner.hostname +  ':' + runner.port + ' (' + (response && response.statusCode? response.statusCode: 'see error above') + ')');
            retryJob(execJob, cb);
        } else {
            log.info(TAG, execJob.jobID + '-' + execJob.execID + ' triggered on runner ' + runner.hostname +  ':' + runner.port + ' (' + response.statusCode + ')');
            execJob.updateAttributes({ state: 'TRIGGERED', lastUpdateTime: Date.now()}, options, function (err, results) {
                if (!err && results) {
                    log.debug(TAG, execJob.jobID + '-' + execJob.execID + ' state updated to TRIGGERED');
                    cb();
                } else {
                    log.error(TAG, execJob.jobID + '-' + execJob.execID + ' state could not be updated to TRIGGERED');
                    cb(new Error(execJob.jobID + '-' + execJob.execID + ' state could not be updated to TRIGGERED'));
                }
            });
        }
    });
}


function retryJob(execJob, cb) {
    if(!execJob.attemptNo) execJob.attemptNo = 0;
    if(execJob.attemptNo < (execJob.maxRetryAttempts || 3)) {
        execJob.updateAttributes({ state: 'RETRYING', attemptNo: (1 + execJob.attemptNo), lastUpdateTime: Date.now()}, options, function (err, results) {
            if(err) {
                log.error(TAG, execJob.jobID + '-' + execJob.execID + ' state could not be updated to RETRYING ' + JSON.stringify(err));
                cb(new Error(execJob.jobID + '-' + execJob.execID + ' state could not be updated to RETRYING ' + JSON.stringify(err)));
            } else if (results) {
                log.debug(TAG, execJob.jobID + '-' + execJob.execID + ' state updated to RETRYING');
                log.warn(TAG, 'Will Retry '+ execJob.jobID + '-' + execJob.execID +' after ' + JOB_TRIGGER_FAIL_RETRY_INTERVAL/1000 + ' sec');
                setTimeout(function() {
                    var attemptNo = execJob.attemptNo || 0;
                    execJob.attemptNo = ++attemptNo;
                    log.warn(TAG, 'Retrying ' + execJob.jobID + '-' + execJob.execID + ' attempt #' + attemptNo);
                    triggerJob(execJob, cb);
                }, JOB_TRIGGER_FAIL_RETRY_INTERVAL);                
            } else {
                log.error(TAG, execJob.jobID + '-' + execJob.execID + ' state could not be updated to RETRYING');
                cb(new Error(execJob.jobID + '-' + execJob.execID + ' state could not be updated to RETRYING'));
            }
        });  

    } else {
        log.error(TAG, execJob.jobID + '-' + execJob.execID +' reached maxRetryAttempts (' + (execJob.maxRetryAttempts || 3) + '). Will not retry.');
        execJob.updateAttributes({ state: 'FAILED', lastUpdateTime: Date.now()}, options, function (err, results) {
            if (!err && results) {
                log.debug(TAG, execJob.jobID + '-' + execJob.execID + ' state updated to FAILED');
                cb(new Error(execJob.jobID + '-' + execJob.execID + ' state updated to FAILED'));
            } else {
                log.error(TAG, execJob.jobID + '-' + execJob.execID + ' state could not be updated to FAILED');
                cb(new Error(execJob.jobID + '-' + execJob.execID + ' state could not be updated to FAILED'));
            }
        });
    }
}

