var loopback = require('loopback');
var JobRunner = loopback.getModelByType('JobRunner');
var JobExecution = loopback.getModelByType('JobExecution');
var Job = loopback.getModelByType('Job');
var request = require('request');
var uuidv4 = require('uuid/v4');
var schedule = require('node-schedule');
var log = require('oe-logger')('jobScheduler');
var TAG = 'JOB_SCHEDULER: ';
var runners;
var currentRunner = -1;


var config;
var confPath = '../../oe-cloud/server/config.js';
try {
    config = require(confPath).jobScheduler;
} catch(e) { log.warn(TAG, e.message); }

var JR_UPDATE_INTERVAL = process.env.JOB_RUNNER_UPDATE_INTERVAL || config && config.runnerUpdateInterval || 15000;
var SCHEDULE_NEW_JOBS_INTERVAL = process.env.SCHEDULE_NEW_JOBS_INTERVAL || config && config.scheduleNewJobsInterval || 30000;
var SCHEDULE_DEFUNCT_JOBS_RETRY_INTERVAL = process.env.DEFUNCT_JOBS_RETRY_INTERVAL || config && config.defunctJobsRetryInterval || 30000;
var JOB_TRIGGER_FAIL_RETRY_DELAY = process.env.JOB_TRIGGER_FAIL_RETRY_DELAY || config && config.jobTriggerFailRetryDelay || 5000;
var DEFUNCT_JOB_TOLERANCE = SCHEDULE_DEFUNCT_JOBS_RETRY_INTERVAL * 3;
var options = {
    ignoreAutoScope: true,
    fetchAllScopes: true
};
var firstSchedule = true;

function start() {
    startScheduler();
}

function stop() {
    log.warn(TAG, 'Stopping Job Scheduler...');
}

module.exports = {
    start: start,
    stop: stop
}


function startScheduler() {
    log.info(TAG, 'Starting Job Scheduler...');

    updateRunners();
    setInterval( updateRunners, JR_UPDATE_INTERVAL); 

    retryDefunctJobs();
    setInterval(retryDefunctJobs, SCHEDULE_DEFUNCT_JOBS_RETRY_INTERVAL);

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
                var now = Date.now();
                var f = function(fireDate) {
                    var fireTime = fireDate? fireDate : new Date(now);
                    var executionID = uuidv4();
                    var execID = executionID.substring(30);
                    var execJob = {
                        executionID: executionID,
                        execID: execID,
                        jobID: job.jobID,
                        schedule: job.schedule,
                        mdl: job.mdl,
                        fn: job.fn,
                        enabled: job.enabled,
                        maxRetryCount: job.maxRetryCount,
                        retryCount : job.retryCount,
                        retryEnabled: job.retryEnabled,
                        scheduleTime: fireTime,
                        lastUpdateTime: new Date(now),
                        createdTime: new Date(now),
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

                job.updateAttributes({scheduled: true}, options, function (err, jb) {
                    if (!err && jb) {
                        // actual scheduling
                        if(job.schedule) schedule.scheduleJob(job.schedule, f);
                        else if(job.interval) setInterval(f, job.interval);

                        log.debug(TAG, 'Scheduled new Job '+ jb.jobID + ' ('+ jb.schedule +')');
                    } else {
                        log.error(TAG, 'Could not update scheduled status for Job '+ job.jobID + (err? JSON.stringify(err): ''));
                    }
                });
            });
            log.debug(TAG, 'New Jobs Scheduled: ' + jobs.length);             
        } else {
            log.debug(TAG, 'No (new) Jobs found');
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
                if((jobExec.lastUpdateTime < (Date.now() - DEFUNCT_JOB_TOLERANCE))) {
                    if(jobExec.retryEnabled === true) {
                        reTrigCount++;
                        log.debug(TAG, 'Re-triggering Job ' + jobExec.jobID + '-' + jobExec.execID);
                        jobExec.retryReason = 'Missed Heartbeat';
                        retryJob(jobExec, function(err) {
                            if(err) log.error(TAG, err && err.message ? err.message : JSON.stringify(err));  //  shutdown scheduler and/or running jobs here?
                        });
                    } else {
                    log.warn(TAG, 'Marking as FAILED Job ' + jobExec.jobID + '-' + jobExec.execID);
                        var now = Date.now();
                        jobExec.updateAttributes({state: 'FAILED', failTime: new Date(now), failReason: 'No Heartbeat (and retry is disabled)', lastUpdateTime: new Date(now)}, options, function (err, results) {
                            if (!err && results) {
                                log.error(TAG, 'Job '+ jobExec.jobID + '-' + jobExec.execID + ' marked as FAILED (retryDefunctJobs)');
                            } else {
                                log.error(TAG, 'Could not mark Job '+ jobExec.jobID + '-' + jobExec.execID + ' as FAILED ' + err? JSON.stringify(err): '');
                            }
                        });
                    }
                }
            });
            log.debug(TAG, 'Found ' + reTrigCount + ' JobExecs for retriggering');                                                   
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
        execJob.retryReason = 'No runner available';
        retryJob(execJob, cb); 
        //return cb(new Error('No runner to execute '+ execJob.jobID + '-' + execJob.execID));
        return;
    } 
    var url = 'http://' + runner.hostname +  ':' + runner.port + '/api/JobRunners/runJob/' + execJob.jobID + '/' +  execJob.executionID;
    request(url, function (error, response, body) {
        if(error) log.error(TAG, execJob.jobID + '-' + execJob.execID + ' trigger error: ' + JSON.stringify(error) + ' errmsg: ' + body); 
        if(error || (response && response.statusCode !== 200)) {
            var b;
            try{ b = JSON.parse(body); } catch(e) {}
            var errMsg = (b && b.error && b.error.message ? b.error.message: (error && error.message ? error.message : JSON.stringify(error)));
             log.warn(TAG, execJob.jobID + '-' + execJob.execID + ' could not be triggered on runner ' + runner.hostname +  ':' + 
            runner.port + '  ' + errMsg);
            execJob.retryReason = errMsg;
            retryJob(execJob, cb);
        } else {
            var now = Date.now();
            var state = execJob.retryCount && execJob.retryCount > 0 ? 'RE-TRIGGERED' : 'TRIGGERED'; 
            var data = { state: state, triggerTime: new Date(now), lastUpdateTime: new Date(now)};
            if(state === 'RE-TRIGGERED') {
                data.retryCount = execJob.retryCount;
                log.debug(TAG, execJob.jobID + '-' + execJob.execID + ' re-triggered on runner ' + runner.hostname +  ':' + runner.port + ' (retry #' + execJob.retryCount + ')');
            } else log.debug(TAG, execJob.jobID + '-' + execJob.execID + ' triggered on runner ' + runner.hostname +  ':' + runner.port);
            if(execJob.retryReason) data.retryReason = execJob.retryReason;
            execJob.updateAttributes(data, options, function (err, results) {
                if (!err && results) {
                    log.debug(TAG, execJob.jobID + '-' + execJob.execID + ' state updated to TRIGGERED');
                    return cb();
                } else {
                    log.error(TAG, execJob.jobID + '-' + execJob.execID + ' state could not be updated to TRIGGERED ' + (err? JSON.stringify(err) : ''));
                    return cb(new Error(execJob.jobID + '-' + execJob.execID + ' state could not be updated to TRIGGERED ' + (err? JSON.stringify(err) : '')));
                }
            });
        }
    });
}


function retryJob(execJob, cb) {
    if(!execJob.retryCount) execJob.retryCount = 0;
    if(execJob.retryCount < (execJob.maxRetryCount || 3)) {
        var now = Date.now();
        var data = { state: 'RETRYING', retryCount: execJob.retryCount, lastUpdateTime: new Date(now)};
        if(execJob.retryReason) data.retryReason = execJob.retryReason;
        execJob.updateAttributes(data, options, function (err, results) {
            if(err) {
                log.error(TAG, execJob.jobID + '-' + execJob.execID + ' state could not be updated to RETRYING ' + JSON.stringify(err));
                return cb(new Error(execJob.jobID + '-' + execJob.execID + ' state could not be updated to RETRYING ' + JSON.stringify(err)));
            } else if (results) {
                log.debug(TAG, execJob.jobID + '-' + execJob.execID + ' state updated to RETRYING');
                log.warn(TAG, 'Will Retry '+ execJob.jobID + '-' + execJob.execID +' after ' + JOB_TRIGGER_FAIL_RETRY_DELAY/1000 + ' sec');
                setTimeout(function() {
                    var retryCount = execJob.retryCount || 0;
                    execJob.retryCount = ++retryCount;
                    log.warn(TAG, 'Retrying ' + execJob.jobID + '-' + execJob.execID + ' retry #' + retryCount);
                    triggerJob(execJob, cb);
                }, JOB_TRIGGER_FAIL_RETRY_DELAY);                
            } else {
                log.error(TAG, execJob.jobID + '-' + execJob.execID + ' state could not be updated to RETRYING');
                cb(new Error(execJob.jobID + '-' + execJob.execID + ' state could not be updated to RETRYING'));
            }
        });  

    } else {
        log.error(TAG, execJob.jobID + '-' + execJob.execID +' reached maxRetryCount (' + (execJob.maxRetryCount || 3) + '). Will not retry.');
        var now = Date.now();
        var data = { state: 'FAILED', retryCount: execJob.retryCount, failTime: new Date(now), failReason: 'Reached maxRetryCount', 
                    lastUpdateTime: new Date(now)};
        execJob.updateAttributes(data, options, function (err, results) {
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

