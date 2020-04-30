var loopback = require('loopback');
var oeCloud = require('oe-cloud');
var request = require('request');
var uuidv4 = require('uuid/v4');
var schedule = require('node-schedule');
var log = require('oe-logger')('jobScheduler');
var os = require('os');
var hostname = os.hostname();
var myInstanceID = uuidv4();
var masterEnabled = false;
var lastMasterEnabledState = false;
var MasterJobExecutor = require('oe-master-job-executor')();
var masterJobExecutor;
var masterJob;
var port;
var runners;
var schedules = [];
var intervals = [];
var currentRunner = -1;
var events = require('events');
var eventEmitter = new events.EventEmitter();
var config = oeCloud.get('jobScheduler');

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
var checkMasterControlInterval;
var updateRunnersInterval;
var retryDefunctJobsInterval;
var scheduleJobsInterval;
var jobRunnerHeartbeatInterval;
var cfg = {
  runnerUpdateInterval: JR_UPDATE_INTERVAL,
  scheduleNewJobsInterval: SCHEDULE_NEW_JOBS_INTERVAL,
  defunctJobsRetryInterval: SCHEDULE_DEFUNCT_JOBS_RETRY_INTERVAL,
  jobTriggerFailRetryDelay: JOB_TRIGGER_FAIL_RETRY_DELAY,
  defunctJobTolerance: DEFUNCT_JOB_TOLERANCE,
  runnerHeartbeatInterval: JR_HEARTBEAT_INTERVAL,
  jobRunnerTolerance: JR_TOLERANCE,
  runnerCleanupInterval: JR_CLEANUP_INTERVAL,
  runnerRetryInterval: JR_RETRY_INTERVAL,
  runnerMaxHeartbeatRetryCount: JR_MAX_HEARTBEAT_RETRY_COUNT,
  runnerRetryDelay: JOB_RUNNER_HEARTBEAT_RETRY_DELAY
};

masterJob = {
  init: init,
  start: start,
  stop: stop,
  executeJobNow: executeJobNow,
  eventEmitter: eventEmitter,
  config: cfg
};
module.exports = masterJob;

function init(server, callback) {
  var TAG = 'init(server, callback): ';
  try {
    port = '' + server.get('port');
    var isRunner = server.get('jobScheduler') ? server.get('jobScheduler').isRunner : false;
    /* istanbul ignore else */
    if (isRunner === true || (process.env.IS_JOB_RUNNER && (process.env.IS_JOB_RUNNER === 'true' || process.env.IS_JOB_RUNNER === 'TRUE'))) {
      becomeJobRunner();
      deleteStaleRunners();
      setInterval(deleteStaleRunners, JR_CLEANUP_INTERVAL);

      log.info(TAG, 'Starting JobScheduler Service');
      var opts = {
        lockName: 'JOB-SCHEDULER',
        masterJob: masterJob
      };
      masterJobExecutor = new MasterJobExecutor(opts);
      log.debug(TAG, 'Created JOB-SCHEDULER MasterJobExecutor: ' + masterJobExecutor);
    } else {
      log.warn(TAG, 'Not a Job Runner (process.env.IS_JOB_RUNNER !== true)');
    }
    return callback();
  } catch (e) {
    // istanbul ignore next
    callback(e);
  }
}


function start() {
  var TAG = 'start(): ';
  log.info(TAG, 'Starting Job Scheduler...');
  firstSchedule = true;

  updateRunners();
  updateRunnersInterval = setInterval(updateRunners, JR_UPDATE_INTERVAL);

  checkMasterControl();
  checkMasterControlInterval = setInterval(checkMasterControl, JR_UPDATE_INTERVAL);

  retryDefunctJobs();
  retryDefunctJobsInterval = setInterval(retryDefunctJobs, SCHEDULE_DEFUNCT_JOBS_RETRY_INTERVAL);

  scheduleJobs();
  scheduleJobsInterval = setInterval(scheduleJobs, SCHEDULE_NEW_JOBS_INTERVAL);
  eventEmitter.emit('job-scheduler-started');
}

function stop() {
  var TAG = 'stop(): ';
  log.info(TAG, 'Stopping Job Scheduler...');
  /* istanbul ignore else */
  if (checkMasterControlInterval) clearInterval(checkMasterControlInterval);
  /* istanbul ignore else */
  if (updateRunnersInterval) clearInterval(updateRunnersInterval);
  /* istanbul ignore else */
  if (retryDefunctJobsInterval) clearInterval(retryDefunctJobsInterval);
  /* istanbul ignore else */
  if (scheduleJobsInterval) clearInterval(scheduleJobsInterval);
  cancelSchedules();
  eventEmitter.emit('job-scheduler-stopped');
}


function deleteStaleRunners() {
  var TAG = 'deleteStaleRunners(): ';
  var JobRunner = loopback.getModelByType('JobRunner');
  var filter = {
    where: {
      heartbeatTime: {
        lt: (Date.now() - JR_TOLERANCE)
      }
    }
  };
  JobRunner.find(filter, options, function findCb(err, staleRunners) {
    /* istanbul ignore if */
    if (err) {
      // eslint-disable-next-line no-console
      console.error(err);
      throw err;
    }
    /* istanbul ignore else */
    if (!err && staleRunners) {
      staleRunners.forEach(function (staleRunner) {
        staleRunner.delete(options, function (err, res) {
          /* istanbul ignore if */
          if (err) {
            // eslint-disable-next-line no-console
            console.error(err);
            log.error(TAG, 'Error while deleting staleRunner: ' + JSON.stringify(err));
          }
          log.debug(TAG, 'Deleted Stale Runner ' + staleRunner.hostname + ':' + staleRunner.port + ' (' + staleRunner.id + ')');
        });
      });
    }
  });
}


function becomeJobRunner() {
  var TAG = 'becomeJobRunner(): ';
  var JobRunner = loopback.getModelByType('JobRunner');
  log.debug(TAG, 'Trying to become JobRunner');
  var data = {
    hostname: hostname,
    port: port,
    instanceID: myInstanceID,
    heartbeatTime: Date.now()
  };

  JobRunner.remove({
    instanceID: myInstanceID
  }, options, function removeCb(err, res) {
    /* istanbul ignore if */
    if (err) {
      // eslint-disable-next-line no-console
      console.error(err);
      log.warn(TAG, 'Could not remove old JobRunner ' + myInstanceID);
    } else {
      JobRunner.create(data, options, function createCb(err, jobRunner) {
        if (!err && jobRunner && jobRunner.id) {
          log.debug(TAG, 'I am a JobRunner (' + JSON.stringify(jobRunner) + ')');
          eventEmitter.emit('became-job-runner', jobRunner.instanceID);
          startJobRunnerHeartbeat(jobRunner);
        } else {
          // istanbul ignore next
          if (err) {
            // eslint-disable-next-line no-console
            console.error(err);
            log.error(TAG, JSON.stringify(err));
          }
          log.warn(TAG, 'Could not create JobRunner record. Will try again in ' + JR_RETRY_INTERVAL / 1000 + ' sec');
          setTimeout(becomeJobRunner, JR_RETRY_INTERVAL);
        }
      });
    }
  });
}


var jobRunnerHeartbeatRetries;
var currentJobRunner;

function startJobRunnerHeartbeat(jobRunner) {
  var TAG = 'startJobRunnerHeartbeat(jobRunner): ';
  currentJobRunner = jobRunner;
  jobRunnerHeartbeatRetries = 0;
  log.debug(TAG, 'Starting JobRunner ' + hostname + ':' + port + ' Heartbeat...');
  sendJobRunnerHeartbeat();
  jobRunnerHeartbeatInterval = setInterval(sendJobRunnerHeartbeat, JR_HEARTBEAT_INTERVAL);
}


function sendJobRunnerHeartbeat() {
  var TAG = 'sendJobRunnerHeartbeat(): ';
  var JobRunner = loopback.getModelByType('JobRunner');
  JobRunner.find({
    id: currentJobRunner.id
  }, options, function (err, res) {
    if (!err && res && res.length === 1) {
      currentJobRunner.updateAttributes({
        heartbeatTime: Date.now()
      }, options, function (err, results) {
        // istanbul ignore else
        if (!err && results) {
          jobRunnerHeartbeatRetries = 0;
          log.debug(TAG, 'Updated JobRunner ' + hostname + ':' + port + ' Heartbeat ' + results.heartbeatTime);
          if (!jobRunnerHeartbeatInterval) jobRunnerHeartbeatInterval = setInterval(sendJobRunnerHeartbeat, JR_HEARTBEAT_INTERVAL);
        } else {
          // eslint-disable-next-line no-console
          console.error(err);
          log.error(JSON.stringify(err));
        }
      });
    } else {
      // istanbul ignore if
      if (err) {
        // eslint-disable-next-line no-console
        console.error(err);
        log.error(JSON.stringify(err));
      }
      if (++jobRunnerHeartbeatRetries > JR_MAX_HEARTBEAT_RETRY_COUNT) {
        log.warn(TAG, 'Could not update JobRunner ' + hostname + ':' + port + ' Heartbeat. Discarding this JobRunner. Will try to become JobRunner again');
        clearInterval(jobRunnerHeartbeatInterval);
        currentJobRunner.delete(options, function (err, res) {
          // istanbul ignore if
          if (err) {
            // eslint-disable-next-line no-console
            console.error(err);
            log.warn(TAG, 'Could not delete bad runner. ' + JSON.stringify(err));
          } else {
            log.debug(TAG, 'Deleted Bad Runner ' + currentJobRunner.hostname + ':' + currentJobRunner.port + ' (' + currentJobRunner.id + ')');
            setTimeout(becomeJobRunner, 200);
          }
        });
      } else {
        log.warn(TAG, 'Could not update JobRunner ' + hostname + ':' + port + ' Heartbeat. Will retry (#' + jobRunnerHeartbeatRetries + ') in ' + JOB_RUNNER_HEARTBEAT_RETRY_DELAY / 1000 + ' sec');
        clearInterval(jobRunnerHeartbeatInterval);
        jobRunnerHeartbeatInterval = null;
        setTimeout(sendJobRunnerHeartbeat, JOB_RUNNER_HEARTBEAT_RETRY_DELAY);
      }
    }
  });
}


function checkMasterControl() {
  var TAG = 'checkMasterControl(): ';
  var MasterControl = loopback.getModelByType('MasterControl');
  MasterControl.findOne({
    where: {
      lockName: 'JOB-SCHEDULER'
    }
  }, options, function findCb(err, masterControl) {
    /* istanbul ignore if */
    if (err) {
      // eslint-disable-next-line no-console
      console.error(err);
      log.error(TAG, 'Could not query for MasterControl ' + JSON.stringify(err));
      return;
    }
    if (masterControl) {
      masterEnabled = false;
      lastMasterEnabledState = false;
      log.debug(TAG, 'JOB-SCHEDULER flagged for disablement. Setting masterEnabled to false');
      cancelSchedules();
    } else {
      masterEnabled = true;
      if (lastMasterEnabledState === false) {
        firstSchedule = true;
      }
      lastMasterEnabledState = true;
      log.debug(TAG, 'JOB-SCHEDULER flagged for enablement. Setting masterEnabled to true');
    }
  });
}


function cancelSchedules() {
  var TAG = 'cancelSchedules(): ';
  if (schedules && schedules.length > 0) {
    log.debug(TAG, 'Cancelling ' + schedules.length + ' existing schedules');
    schedules.forEach(function (schedule, i) {
      /* istanbul ignore else */
      if (schedule) {
        schedule.cancel();
        log.debug(TAG, 'Cancelled schedule #' + i);
      }
    });
    schedules = [];
  } else {
    log.debug(TAG, 'No existing schedules to cancel');
  }

  if (intervals && intervals.length > 0) {
    log.debug(TAG, 'Cancelling ' + intervals.length + ' existing intervals');
    intervals.forEach(function (interval, i) {
      // istanbul ignore else
      if (interval) {
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
  var Job = loopback.getModelByType('Job');
  var TAG = 'scheduleJobs(): ';
  if (!masterEnabled) {
    log.debug(TAG, 'Not scheduling new Jobs as Master is disabled');
    return;
  }

  var filter = {
    where: {
      enabled: true,
      scheduled: false
    }
  };
    /* istanbul ignore else */
  if (firstSchedule) {
    filter = {
      where: {
        enabled: true
      }
    };
    firstSchedule = false;
  }
  Job.find(filter, options, function findCb(err, jobs) {
    /* istanbul ignore if */
    if (err) {
      // eslint-disable-next-line no-console
      console.error(err);
      log.error(TAG, 'Could not fetch jobs for scheduling. ' + JSON.stringify(err));
    } else
    /* istanbul ignore else */
    if (jobs && jobs.length > 0) {
      jobs.forEach(function (job) {
        var j;
        var f = function (fireDate) {
          executeJob(j, job, fireDate, 'NORMAL');
        };

        job.updateAttributes({
          scheduled: true
        }, options, function (err, jb) {
          // istanbul ignore else
          if (!err && jb) {
            // actual scheduling
            if (job.schedule && job.schedule !== 'chain') {
              if (job.schedule.trim().startsWith('{')) {
                j = schedule.scheduleJob(JSON.parse(job.schedule), f);
              } else j = schedule.scheduleJob(job.schedule, f);
              schedules.push(j);
            } else
            // istanbul ignore else
            if (job.interval) {
              var i = setInterval(f, job.interval);
              intervals.push(i);
            }
            eventEmitter.emit('job-scheduler-scheduled-new-job', jb.jobID, jb.schedule || jb.interval);
            log.debug(TAG, 'Scheduled new Job ' + jb.jobID + ' (' + (jb.schedule ? jb.schedule : jb.interval) + ')');
          } else {
            // eslint-disable-next-line no-console
            console.error(err);
            log.error(TAG, 'Could not update scheduled status for Job ' + job.jobID + (err ? JSON.stringify(err) : ''));
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
  var TAG = 'executeJob(j, job, fireDate, type): ';
  var now = Date.now();
  var fireTime = fireDate ? fireDate : new Date(now);
  var executionID = uuidv4();
  var execID = executionID.substring(30);
  var execJob = {
    executionID: executionID,
    execID: execID,
    jobID: job.jobID,
    schedule: job.schedule,
    mdl: job.mdl,
    fn: job.fn,
    parameter: job.parameter,
    successors: job.successors,
    enabled: job.enabled || false,
    maxRetryCount: job.maxRetryCount || 0,
    retryCount: job.retryCount || 0,
    retryEnabled: job.retryEnabled || false,
    scheduleTime: fireTime,
    lastUpdateTime: new Date(now),
    createdTime: new Date(now),
    state: 'CREATED',
    type: type
  };
  var JobExecution = loopback.getModelByType('JobExecution');
  JobExecution.updateAll({
    'jobID': job.jobID
  }, {
    'nextTriggerTime': null
  }, options, function (err, res) {
    /* istanbul ignore if */
    if (err) {
      // eslint-disable-next-line no-console
      console.error(err);
      log.warn(TAG, 'Could not set nextTriggerTime to null for ' + job.jobID);
    } else {
      JobExecution.create(execJob, options, function (err, jobExec) {
        /* istanbul ignore if */
        if (err || !jobExec) {
          // eslint-disable-next-line no-console
          console.error(err);
          log.error(TAG, 'Could not create JobExecution record for ' + job.jobID + '-' + execID);
        } else {
          triggerRemoteJob(j, jobExec, function (err) {
            //  shutdown scheduler and/or running jobs here?
            if (err) log.error(TAG, err && err.message ? err.message : JSON.stringify(err));
          });
        }
      });
    }
  });
}


function retryDefunctJobs() {
  var TAG = 'retryDefunctJobs(): ';
  var JobExecution = loopback.getModelByType('JobExecution');
  var Job = loopback.getModelByType('Job');
  var filter = {
    where: {
      and: [{
        state: {
          neq: 'COMPLETED'
        }
      }, {
        state: {
          neq: 'FAILED'
        }
      }, {
        state: {
          neq: 'SKIPPED'
        }
      }]
    }
  };
  JobExecution.find(filter, options, function findCb(err, jobExecs) {
    /* istanbul ignore if */
    if (err) {
      // eslint-disable-next-line no-console
      console.error(err);
      log.error(TAG, 'Could not fetch jobExecs for triggering. ' + JSON.stringify(err));
    } else if (jobExecs && jobExecs.length > 0) {
      var reTrigCount = 0;
      jobExecs.forEach(function (jobExec) {
        if ((jobExec.lastUpdateTime < (Date.now() - DEFUNCT_JOB_TOLERANCE))) {
          if (jobExec.retryEnabled === true) {
            reTrigCount++;
            log.debug(TAG, 'Re-triggering Job ' + jobExec.jobID + '-' + jobExec.execID);
            jobExec.retryReason = 'Missed Heartbeat';
            // console.log('Emitting retry-job event');
            eventEmitter.emit('retry-job', jobExec.jobID);
            retryJob(null, jobExec, function (err) {
              //  shutdown scheduler and/or running jobs here?
              if (err) log.error(TAG, err && err.message ? err.message : JSON.stringify(err));
            });
          } else {
            log.warn(TAG, 'Marking as FAILED Job ' + jobExec.jobID + '-' + jobExec.execID);
            var now = Date.now();
            jobExec.updateAttributes({
              state: 'FAILED',
              failTime: new Date(now),
              failReason: 'No Heartbeat (and retry is disabled)',
              lastUpdateTime: new Date(now)
            }, options, function (err, results) {
              if (!err && results) {
                log.error(TAG, 'Job ' + jobExec.jobID + '-' + jobExec.execID + ' marked as FAILED (retryDefunctJobs)');
              } else {
                // eslint-disable-next-line no-console
                console.error(err);
                log.error(TAG, 'Could not mark Job ' + jobExec.jobID + '-' + jobExec.execID + ' as FAILED ' + err ? JSON.stringify(err) : '');
              }
            });
          }
        }
      });
      log.debug(TAG, 'Found ' + reTrigCount + ' JobExecs for retriggering');
    }
  });

  if (masterEnabled) {
    log.debug(TAG, 'Checking for missed executions');
    filter = {
      where: {
        and: [{
          nextTriggerTime: {
            neq: null
          }
        }, {
          nextTriggerTime: {
            lt: new Date(new Date() - (5 * 1000))
          }
        }]
      }
    };
    /* istanbul ignore if */
    if (JobExecution.dataSource.connector.name === 'postgresql') {
      filter = {
        where: {
          nextTriggerTime: {
            lt: new Date(new Date() - (5 * 1000))
          }
        }
      };
    }
    JobExecution.find(filter, options, function findCb(err, missedJobCandidates) {
      /* istanbul ignore if */
      if (err) {
        // eslint-disable-next-line no-console
        console.error(err);
        log.warn(TAG, 'Could not query JobExecution for missed triggers');
      } else {
        var missedJobs = [];
        missedJobCandidates.forEach(function (missedJobCandidate) {
          missedJobs.push(missedJobCandidate.jobID + '-' + missedJobCandidate.execID);
          missedJobCandidate.updateAttributes({
            'nextTriggerTime': null
          }, options, function (err, res) {
            /* istanbul ignore if */
            if (err) {
              // eslint-disable-next-line no-console
              console.error(err);
              log.warn(TAG, 'Could not execute missed execution ' + JSON.stringify(err));
            } else {
              Job.findOne({
                where: {
                  jobID: missedJobCandidate.jobID
                }
              }, options, function findCb(err, job) {
                // istanbul ignore if
                if (err) {
                  // eslint-disable-next-line no-console
                  console.error(err);
                  log.warn(TAG, 'Could not query Job for missed retry');
                } else
                /* istanbul ignore else */
                if (job) {
                  log.debug(TAG, 'EXECUTING MISSED JOB: ' + job.jobID);
                  executeJob(null, job, new Date(), 'MISSED');
                  // console.log('Emitting execute-missed-job event');
                  eventEmitter.emit('execute-missed-job', job.jobID);
                } else {
                  log.error(TAG, 'Could not find Job Definition in Job table for missed job execID ' + missedJobCandidate.execID);
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
  if (runners && runners.length > 0) {
    var nextRunner = ++currentRunner;
    if (nextRunner > runners.length - 1) {
      nextRunner = 0;
      currentRunner = 0;
    }
    return runners[nextRunner];
  }
  return null;
}


function updateRunners() {
  var TAG = 'updateRunners(): ';
  var JobRunner = loopback.getModelByType('JobRunner');
  JobRunner.find({}, options, function findCb(err, allRunners) {
    /* istanbul ignore if */
    if (err) {
      // eslint-disable-next-line no-console
      console.error(err);
      log.error(TAG, 'Could not query for runners. ' + JSON.stringify(err));
    }
    if (!err && allRunners.length > 0) {
      runners = allRunners;
    } else {
      runners = [];
      log.warn(TAG, 'No active job-runners were found for updating runner list');
    }
  });
}

function triggerRemoteJob(schedule, execJob, cb) {
  var TAG = 'triggerRemoteJob(schedule, execJob, cb): ';
  var runner = getRunner();
  if (!runner) {
    log.warn(TAG, 'No runner to execute ' + execJob.jobID + '-' + execJob.execID);
    execJob.retryReason = 'No runner available';
    retryJob(schedule, execJob, cb);
    return;
  }
  var url = 'http://' + runner.hostname + ':' + runner.port + '/api/JobRunners/runJob/' + execJob.jobID + '/' + execJob.executionID;
  request(url, function (error, response, body) {
    // istanbul ignore if
    if (error) log.error(TAG, execJob.jobID + '-' + execJob.execID + ' trigger error: ' + JSON.stringify(error) + ' errmsg: ' + body);
    if (error || (response && response.statusCode !== 200)) {
      var b;
      try {
        b = JSON.parse(body);
      } catch (e) {
        log.error(TAG, 'Could not parse JSON: ' + body);
      }
      var errMsg = (b && b.error && b.error.message ? b.error.message : (error && error.message ? error.message : JSON.stringify(error)));
      log.error(TAG, execJob.jobID + '-' + execJob.execID + ' could not be triggered on runner ' + runner.hostname + ':' +
                runner.port + '  ' + errMsg + 'URL: ' + url);
      execJob.retryReason = errMsg;
      retryJob(schedule, execJob, cb);
    } else {
      var now = Date.now();
      var state = execJob.retryCount && execJob.retryCount > 0 ? 'RE-TRIGGERED' : 'TRIGGERED';
      var data = {
        state: state,
        triggerTime: new Date(now),
        lastUpdateTime: new Date(now),
        runner: runner.hostname + ':' + runner.port
      };
      if (schedule) {
        data.nextTriggerTime = new Date(schedule.nextInvocation());
        data.nextRunTime = new Date(schedule.nextInvocation());
      }
      if (state === 'RE-TRIGGERED') {
        data.retryCount = execJob.retryCount;
        log.debug(TAG, execJob.jobID + '-' + execJob.execID + ' re-triggered on runner ' + runner.hostname + ':' + runner.port + ' (retry #' + execJob.retryCount + ')');
      } else log.debug(TAG, execJob.jobID + '-' + execJob.execID + ' triggered on runner ' + runner.hostname + ':' + runner.port);
      if (execJob.retryReason) data.retryReason = execJob.retryReason;
      execJob.updateAttributes(data, options, function (err, results) {
        /* istanbul ignore else */
        if (!err && results) {
          log.debug(TAG, execJob.jobID + '-' + execJob.execID + ' state updated to TRIGGERED');
          return cb();
        }
        log.error(TAG, execJob.jobID + '-' + execJob.execID + ' state could not be updated to TRIGGERED ' + (err ? JSON.stringify(err) : ''));
        return cb(new Error(execJob.jobID + '-' + execJob.execID + ' state could not be updated to TRIGGERED ' + (err ? JSON.stringify(err) : '')));
      });
    }
  });
}


function retryJob(schedule, execJob, cb) {
  var TAG = 'retryJob(schedule, execJob, cb): ';
  if (!execJob.retryCount) execJob.retryCount = 0;
  if (execJob.retryCount < (execJob.maxRetryCount || 3)) {
    var now = Date.now();
    var data = {
      state: 'RETRYING',
      retryCount: execJob.retryCount,
      lastUpdateTime: new Date(now)
    };
    if (execJob.retryReason) data.retryReason = execJob.retryReason;
    execJob.updateAttributes(data, options, function (err, results) {
      /* istanbul ignore if */
      if (err) {
        // eslint-disable-next-line no-console
        console.error(err);
        log.error(TAG, execJob.jobID + '-' + execJob.execID + ' state could not be updated to RETRYING ' + JSON.stringify(err));
        return cb(new Error(execJob.jobID + '-' + execJob.execID + ' state could not be updated to RETRYING ' + JSON.stringify(err)));
      } else
      /* istanbul ignore else */
      if (results) {
        log.debug(TAG, execJob.jobID + '-' + execJob.execID + ' state updated to RETRYING');
        log.warn(TAG, 'Will Retry ' + execJob.jobID + '-' + execJob.execID + ' after ' + JOB_TRIGGER_FAIL_RETRY_DELAY / 1000 + ' sec');
        setTimeout(function () {
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
    log.error(TAG, execJob.jobID + '-' + execJob.execID + ' reached maxRetryCount (' + (execJob.maxRetryCount || 3) + '). Will not retry.');
    now = Date.now();
    data = {
      state: 'FAILED',
      retryCount: execJob.retryCount,
      failTime: new Date(now),
      failReason: 'Reached maxRetryCount',
      lastUpdateTime: new Date(now)
    };
    execJob.updateAttributes(data, options, function (err, results) {
      if (!err && results) {
        log.debug(TAG, execJob.jobID + '-' + execJob.execID + ' state updated to FAILED');
        cb(new Error(execJob.jobID + '-' + execJob.execID + ' state updated to FAILED'));
      } else {
        // eslint-disable-next-line no-console
        console.error(err);
        log.error(TAG, execJob.jobID + '-' + execJob.execID + ' state could not be updated to FAILED');
        cb(new Error(execJob.jobID + '-' + execJob.execID + ' state could not be updated to FAILED'));
      }
    });
  }
}


function executeJobNow(jobID, params, cb) {
  var TAG = 'executeJobNow(jobID, params, cb): ';
  var Job = loopback.getModelByType('Job');
  var filter = {
    where: {
      jobID: jobID
    }
  };
  Job.find(filter, options, function findCb(err, jobs) {
    /* istanbul ignore if */
    if (err) {
      // eslint-disable-next-line no-console
      console.error(err);
      log.error(TAG, 'Could not fetch jobs for scheduling. ' + JSON.stringify(err));
      return cb(new Error('Could not fetch jobs for scheduling. ' + JSON.stringify(err)));
    } else
    /* istanbul ignore else */
    if (jobs && jobs.length > 0) {
      var job = jobs[0];
      var now = Date.now();
      var fireTime = new Date(now);
      var executionID = uuidv4();
      var execID = executionID.substring(30);
      var execJob = {
        executionID: executionID,
        execID: execID,
        jobID: job.jobID,
        schedule: job.schedule,
        mdl: job.mdl,
        fn: job.fn,
        parameter: params || job.parameter,
        successors: job.successors,
        enabled: job.enabled || false,
        maxRetryCount: job.maxRetryCount || 0,
        retryCount: job.retryCount || 0,
        retryEnabled: job.retryEnabled || false,
        scheduleTime: fireTime,
        lastUpdateTime: new Date(now),
        createdTime: new Date(now),
        state: 'CREATED',
        type: 'NORMAL'
      };
      var JobExecution = loopback.getModelByType('JobExecution');
      JobExecution.create(execJob, options, function (err, jobExec) {
        /* istanbul ignore if */
        if (err || !jobExec) {
          // eslint-disable-next-line no-console
          console.error(err);
          log.error(TAG, 'Could not create JobExecution record for ' + job.jobID + '-' + execID);
          return cb(new Error('Could not create JobExecution record for ' + job.jobID + '-' + execID));
        }
        var runner = getRunner();
        if (!runner) {
          log.warn(TAG, 'No runner to execute ' + jobID);
          return cb(new Error('No runner to execute ' + jobID));
        }

        var url = 'http://' + runner.hostname + ':' + runner.port + '/api/JobRunners/runJob/' + jobID + '/' + executionID;
        request(url, function (error, response, body) {
          // istanbul ignore if
          if (error) log.error(TAG, jobID + '-' + executionID + ' trigger error: ' + JSON.stringify(error) + ' errmsg: ' + body);
          if (error || (response && response.statusCode !== 200)) {
            var b;
            try {
              b = JSON.parse(body);
            } catch (e) {
              log.error(TAG, 'Could not parse JSON: ' + body);
            }
            var errMsg = (b && b.error && b.error.message ? b.error.message : (error && error.message ? error.message : JSON.stringify(error)));
            log.error(TAG, jobID + '-' + executionID + ' could not be triggered on runner ' + runner.hostname + ':' +
                                    runner.port + '  ' + errMsg + 'URL: ' + url);
            return cb(new Error(errMsg));
          }
          var now = Date.now();
          var state = 'TRIGGERED_MANUALLY';
          var data = {
            state: state,
            triggerTime: new Date(now),
            lastUpdateTime: new Date(now),
            runner: runner.hostname + ':' + runner.port
          };
          log.debug(TAG, jobID + '-' + executionID + ' triggered on runner ' + runner.hostname + ':' + runner.port);
          jobExec.updateAttributes(data, options, function (err, results) {
            /* istanbul ignore else */
            if (!err && results) {
              log.debug(TAG, jobID + '-' + executionID + ' state updated to TRIGGERED_MANUALLY');
              return cb();
            }
            log.error(TAG, jobID + '-' + executionID + ' state could not be updated to TRIGGERED_MANUALLY ' + (err ? JSON.stringify(err) : ''));
            return cb(new Error(jobID + '-' + executionID + ' state could not be updated to TRIGGERED_MANUALLY ' + (err ? JSON.stringify(err) : '')));
          });
        });
      });
    } else {
      log.debug(TAG, 'No Job found with jobID ' + jobID);
      return cb(new Error('No Job found with jobID ' + jobID));
    }
  });
}
