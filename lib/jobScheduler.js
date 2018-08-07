var loopback = require('loopback');
var Job = loopback.getModelByType('Job');
var request = require('request');
var uuidv4 = require('uuid/v4');
var schedule = require('node-schedule');
var log = require('oe-logger')('jobScheduler');
var MasterControl = loopback.getModelByType('MasterControl');
var os = require('os');
var hostname = os.hostname();
var myInstanceID = uuidv4();
var masterEnabled = false;
var lastMasterEnabledState = false;
var masterJobExecutor = require('oe-master-job-executor');
var masterJob, config, port, runners;
var TAG = 'JOB_SCHEDULER: ';
var schedules = [], intervals = [];
var currentRunner = -1;

var confPath = '../../oe-cloud/server/config.js';
try {
    config = require(confPath).jobScheduler;
} catch(e) { log.warn(TAG, e.message); }

var JR_UPDATE_INTERVAL = process.env.JOB_RUNNER_UPDATE_INTERVAL || config && config.runnerUpdateInterval || 15000;
var SCHEDULE_NEW_JOBS_INTERVAL = process.env.SCHEDULE_NEW_JOBS_INTERVAL || config && config.scheduleNewJobsInterval || 30000;
var SCHEDULE_DEFUNCT_JOBS_RETRY_INTERVAL = process.env.DEFUNCT_JOBS_RETRY_INTERVAL || config && config.defunctJobsRetryInterval || 30000;
var JOB_TRIGGER_FAIL_RETRY_DELAY = process.env.JOB_TRIGGER_FAIL_RETRY_DELAY || config && config.jobTriggerFailRetryDelay || 5000;
var DEFUNCT_JOB_TOLERANCE = SCHEDULE_DEFUNCT_JOBS_RETRY_INTERVAL * 3;

var JR_HEARTBEAT_INTERVAL = process.env.JOB_RUNNER_HEARTBEAT_INTERVAL || config && config.runnerHeartbeatInterval || 20000;
var JR_TOLERANCE = JR_HEARTBEAT_INTERVAL * 3;
var JR_CLEANUP_INTERVAL = process.env.JOB_RUNNER_CLEANUP_INTERVAL || config && config.runnerCleanupInterval || 15000;
var JR_RETRY_INTERVAL = process.env.JOB_RUNNER_RETRY_INTERVAL || config && config.runnerRetryInterval || 60000;
var JR_MAX_HEARTBEAT_RETRY_COUNT = process.env.JOB_RUNNER_MAX_HEARTBEAT_RETRY_COUNT || config && config.runnerMaxHeartbeatRetryCount || 3;
var JOB_RUNNER_HEARTBEAT_RETRY_DELAY = process.env.JOB_RUNNER_HEARTBEAT_RETRY_DELAY || config && config.runnerRetryDelay || 2000;

var options = {
    ignoreAutoScope: true,
    fetchAllScopes: true
};
var firstSchedule = true;
var checkMasterControlInterval, updateRunnersInterval, retryDefunctJobsInterval, scheduleJobsInterval;
var jobRunnerHeartbeatInterval;

var masterJob = { init: init, start: start, stop: stop };
module.exports = masterJob;

function init(server, callback) {
    
    try {
        port = '' + server.get('port');

        if(process.env.IS_JOB_RUNNER && (process.env.IS_JOB_RUNNER ==='true' || process.env.IS_JOB_RUNNER ==='TRUE')) {
            
            becomeJobRunner();
            deleteStaleRunners();
            setInterval(deleteStaleRunners, JR_CLEANUP_INTERVAL);

            log.info(TAG, 'Starting JobScheduler Service');
            var options = { lockName: 'JOB-SCHEDULER', masterJob: masterJob };
            masterJobExecutor.startMaster(options);
        
        } else {
            log.warn(TAG, 'Not a Job Runner (process.env.IS_JOB_RUNNER !== true)');
        }
        return callback();
    } catch(e) {
        callback(e);
    }
    
};


function start() {
    log.info(TAG, 'Starting Job Scheduler...');
    firstSchedule = true;

    updateRunners();
    updateRunnersInterval = setInterval( updateRunners, JR_UPDATE_INTERVAL); 

    checkMasterControl();
    checkMasterControlInterval = setInterval( checkMasterControl, JR_UPDATE_INTERVAL); 

    retryDefunctJobs();
    retryDefunctJobsInterval = setInterval(retryDefunctJobs, SCHEDULE_DEFUNCT_JOBS_RETRY_INTERVAL);

    scheduleJobs();
    scheduleJobsInterval = setInterval(scheduleJobs, SCHEDULE_NEW_JOBS_INTERVAL);
    
}

function stop() {
    log.info(TAG, 'Stopping Job Scheduler...');
    if(checkMasterControlInterval) clearInterval(checkMasterControlInterval);
    if(updateRunnersInterval) clearInterval(updateRunnersInterval);
    if(retryDefunctJobsInterval) clearInterval(retryDefunctJobsInterval);
    if(scheduleJobsInterval) clearInterval(scheduleJobsInterval);
    cancelSchedules();
}


function deleteStaleRunners() {
    var JobRunner = loopback.getModelByType('JobRunner');
    var filter = {
        where: {
            heartbeatTime: {lt: (Date.now() - JR_TOLERANCE) }
        }
    };
    JobRunner.find(filter, options, function findCb(err, staleRunners) {
        if(err) throw err;         
        if (!err && staleRunners) {                                                   
            staleRunners.forEach(function(staleRunner) {
                staleRunner.delete(options, function (err, res) {                        
                    log.debug(TAG, 'Deleted Stale Runner ' + staleRunner.hostname + ':' + staleRunner.port + ' ('+ staleRunner.id +')');
                });
            });      
        }
    });
}


function becomeJobRunner() {
    var JobRunner = loopback.getModelByType('JobRunner');
    log.debug(TAG, 'Trying to become JobRunner');
    var data = {
        hostname: hostname,
        port: port,
        instanceID: myInstanceID,
        heartbeatTime: Date.now()
    };
    
    JobRunner.remove({instanceID: myInstanceID}, options, function removeCb(err, res) {
        if(err) log.warn(TAG, 'Could not remove old JobRunner ' + myInstanceID);
        else {
            JobRunner.create(data, options, function createCb(err, jobRunner) {
                if (!err && jobRunner && jobRunner.id) {
                    log.info(TAG, 'I am a JobRunner (' + hostname + ':' + port + ')');
                    startJobRunnerHeartbeat(jobRunner);
                } else {
                    if(err) log.error(TAG, JSON.stringify(err));
                    log.warn(TAG, 'Could not create JobRunner record. Will try again in ' + JR_RETRY_INTERVAL/1000 + ' sec');
                    setTimeout(becomeJobRunner, JR_RETRY_INTERVAL);
                }
            });
        }
    });

}


var jobRunnerHeartbeatRetries, currentJobRunner;
function startJobRunnerHeartbeat(jobRunner) {
    currentJobRunner = jobRunner;
    jobRunnerHeartbeatRetries = 0;
    log.debug(TAG, 'Starting JobRunner '+ hostname + ':' + port +' Heartbeat...');
    sendJobRunnerHeartbeat();
    jobRunnerHeartbeatInterval = setInterval(sendJobRunnerHeartbeat, JR_HEARTBEAT_INTERVAL);
}


function sendJobRunnerHeartbeat() {
    currentJobRunner.updateAttributes({ heartbeatTime: Date.now()}, options, function (err, results) {
        if (!err && results) {
            jobRunnerHeartbeatRetries = 0;
            log.debug(TAG, 'Updated JobRunner '+ hostname + ':' + port +' Heartbeat ' + results.heartbeatTime);
            if(!jobRunnerHeartbeatInterval) jobRunnerHeartbeatInterval = setInterval(sendJobRunnerHeartbeat, JR_HEARTBEAT_INTERVAL);
        } else {
            if(err) log.error(JSON.stringify(err));
            if(++jobRunnerHeartbeatRetries > JR_MAX_HEARTBEAT_RETRY_COUNT) {
                log.warn(TAG, 'Could not update JobRunner '+ hostname + ':' + port +' Heartbeat. Discarding this JobRunner. Will try to become JobRunner again');
                clearInterval(jobRunnerHeartbeatInterval);
                currentJobRunner.delete(options, function (err, res) {
                    if(err) log.warn(TAG, 'Could not delete bad runner. ' + JSON.stringify(err));  
                    else {
                        log.debug(TAG, 'Deleted Bad Runner ' + currentJobRunner.hostname + ':' + currentJobRunner.port + ' ('+ currentJobRunner.id +')');
                        setTimeout(becomeJobRunner, 200);
                    }                      
                });

            } else {
                log.warn(TAG, 'Could not update JobRunner '+ hostname + ':' + port +' Heartbeat. Will retry (#'+ jobRunnerHeartbeatRetries +') in ' + JOB_RUNNER_HEARTBEAT_RETRY_DELAY/1000 + ' sec');
                clearInterval(jobRunnerHeartbeatInterval);
                jobRunnerHeartbeatInterval = null;
                setTimeout(sendJobRunnerHeartbeat, JOB_RUNNER_HEARTBEAT_RETRY_DELAY);
            }
        }
    });
}



function checkMasterControl() {
    MasterControl.findOne({where: {lockName: 'JOB-SCHEDULER'}}, options, function findCb(err, masterControl) {
        if(err) {
            log.error(TAG, 'Could not query for MasterControl ' + JSON.stringify(err));
            return;
        } else {
            if(masterControl) {
                masterEnabled = false;
                lastMasterEnabledState = false;
                log.debug(TAG, 'JOB-SCHEDULER flagged for disablement. Setting masterEnabled to false');
                cancelSchedules();
            } else {
                masterEnabled = true;
                if(lastMasterEnabledState === false) {
                    firstSchedule = true;
                }
                lastMasterEnabledState = true;
                log.debug(TAG, 'JOB-SCHEDULER flagged for enablement. Setting masterEnabled to true');
            }
        }
    });
}


function cancelSchedules() {
    if(schedules && schedules.length > 0) {
        log.debug(TAG, 'Cancelling ' + schedules.length + ' existing schedules');
        schedules.forEach(function(schedule, i) {
            if(schedule) {
                schedule.cancel();
                log.debug(TAG, 'Cancelled schedule #' + i);
            }
        });
        schedules = [];
    } else {
        log.debug(TAG, 'No existing schedules to cancel');
    }

    if(intervals && intervals.length > 0) {
        log.debug(TAG, 'Cancelling ' + intervals.length + ' existing intervals');
        intervals.forEach(function(interval, i) {
            if(interval) {
                clearInterval(interval);
                log.debug(TAG, 'Cancelled interval #' + i);
            }
        });
        intervals = [];
    } else {
        log.debug(TAG, 'No existing intervals to cancel');
    }

}



function scheduleJobs() {

    if(!masterEnabled) {
        log.debug(TAG, 'Not scheduling new Jobs as Master is disabled');
        return;
    }

    var filter = {where: {enabled: true, scheduled: false}};
    if(firstSchedule) {
        filter = {where: {enabled: true}};
        firstSchedule = false;
    }
    Job.find(filter, options, function findCb(err, jobs) {
        if(err) log.error(TAG, 'Could not fetch jobs for scheduling. ' + JSON.stringify(err));         
        else if(jobs && jobs.length > 0) {                                                   
            jobs.forEach(function(job) {
                var j;
                var f = function(fireDate) {
                    executeJob(j, job, fireDate, 'NORMAL');
                };

                job.updateAttributes({scheduled: true}, options, function (err, jb) {
                    if (!err && jb) {
                        // actual scheduling
                        if(job.schedule) {
                            j = schedule.scheduleJob(job.schedule, f);
                            schedules.push(j);
                        }
                        else if(job.interval) {
                            var i = setInterval(f, job.interval);
                            intervals.push(i);
                        }

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


function executeJob(j, job, fireDate, type) {
    var now = Date.now();
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
        state: 'CREATED',
        type: type
    };
    var JobExecution = loopback.getModelByType('JobExecution');
    JobExecution.updateAll({"jobID": job.jobID}, {"nextTriggerTime": null}, options, function(err, res) {
        if(err) log.warn(TAG, 'Could not set nextTriggerTime to null for ' + job.jobID);
        else {
            JobExecution.create(execJob, options, function(err, jobExec) {
                if(err || !jobExec) log.error(TAG, 'Could not create JobExecution record for ' + job.jobID + '-' + execID);
                else {
                    triggerRemoteJob(j, jobExec, function(err) {
                        if(err) log.error(TAG, err && err.message ? err.message : JSON.stringify(err));  //  shutdown scheduler and/or running jobs here?
                    });
                }
            });
        }
    
    });

}


function retryDefunctJobs() {
    var JobExecution = loopback.getModelByType('JobExecution');
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
                        retryJob(null, jobExec, function(err) {
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

    if(masterEnabled) {
        log.debug(TAG, 'Checking for missed executions');
        filter = {where: { and: [{nextTriggerTime: { neq : null}}, {nextTriggerTime: { lt : new Date(new Date() - (30 * 1000)) }}]}};
        JobExecution.find(filter, options, function findCb(err, missedJobCandidates) {
            if(err) log.warn(TAG, 'Could not query JobExecution for missed triggers');
            else {
                var missedJobs = [];
                missedJobCandidates.forEach(function(missedJobCandidate) {
                    missedJobs.push(missedJobCandidate.jobID + '-' + missedJobCandidate.execID);
                    missedJobCandidate.updateAttributes({"nextTriggerTime": null}, options, function(err, res) {
                        if(err) log.warn(TAG, 'Could not execute missed execution ' + JSON.stringify(err));
                        else {
                            Job.findOne({where: {jobID: missedJobCandidate.jobID}}, options, function findCb(err, job) {
                                if(err) log.warn(TAG, 'Could not query Job for missed retry');
                                else {
                                    log.debug(TAG, 'EXECUTING MISSED JOB: ' + job.jobID);
                                    executeJob(null, job, new Date(), 'MISSED');
                                }
                            });
                        }
                    });
                });
                log.debug(TAG, 'Last Job(s) before miss: ' + JSON.stringify(missedJobs));
            }
        });
    } else {
        log.debug(TAG, 'Not checking for missed executions as masterEnabled === false');
    }
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
    var JobRunner = loopback.getModelByType('JobRunner');
    JobRunner.find({}, options, function findCb(err, allRunners) {
        if(err) log.error(TAG, 'Could not query for runners. ' + JSON.stringify(err));         
        if (!err && allRunners.length > 0) {                                                   
            runners = allRunners;
        } else {
            runners = [];
            log.warn(TAG, 'No active job-runners were found for updating runner list');
        }
    });
}

function triggerRemoteJob(schedule, execJob, cb) {
    var runner = getRunner();
    if(!runner) {
        log.warn(TAG, 'No runner to execute '+ execJob.jobID + '-' + execJob.execID);
        execJob.retryReason = 'No runner available';
        retryJob(schedule, execJob, cb); 
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
            runner.port + '  ' + errMsg + 'URL: ' + url);
            execJob.retryReason = errMsg;
            retryJob(schedule, execJob, cb);
        } else {
            var now = Date.now();
            var state = execJob.retryCount && execJob.retryCount > 0 ? 'RE-TRIGGERED' : 'TRIGGERED';
            var data = { state: state, triggerTime: new Date(now), lastUpdateTime: new Date(now), runner: runner.hostname +  ':' + runner.port};
            if(schedule) data.nextTriggerTime = new Date(schedule.nextInvocation());
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


function retryJob(schedule, execJob, cb) {
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
                    triggerRemoteJob(schedule, execJob, cb);
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

