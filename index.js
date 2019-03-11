var loopback = require('loopback');
var log = require('oe-logger')('oeJobScheduler');
var jobSch = require('./lib/jobScheduler');
var eventEmitter = jobSch.eventEmitter;
var options = {
  ignoreAutoScope: true,
  fetchAllScopes: true
};

function updateExecutionHeartbeat(executionID, completionStatus, cb) {
  var state = 'RUNNING';
  if (!cb && typeof completionStatus === 'function') {
    cb = completionStatus;
    completionStatus = null;
  }
  /* istanbul ignore else */
  if (completionStatus && ( typeof completionStatus === 'number' || typeof completionStatus === 'string')) {
    // eslint-disable-next-line no-console
    console.log('WARNING: Completion status for executionID ' + executionID + ' is provided as ' + (typeof completionStatus) + '. Needs to be Object.' );
    completionStatus = { completionStatus: completionStatus};
  }

  setExecutionState(executionID, state, completionStatus, cb);
}

function setExecutionState(executionID, state, completionStatus, cb) {
  var TAG = 'setExecutionState(executionID, state, completionStatus, cb): ';
  var JobExecution = loopback.getModelByType('JobExecution');
  JobExecution.findOne({
    where: {
      executionID: executionID
    }
  }, options, function findCb(err, execJob) {
    /* istanbul ignore if */
    if (err) {
      // eslint-disable-next-line no-console
      console.error(err);
      log.error(TAG, 'Could not set state for executionID ' + executionID + ' to ' + state + ': ' + JSON.stringify(err));
      cb(err);
    } else {
      var now = Date.now();
      var data = {
        state: state,
        lastUpdateTime: new Date(now)
      };
      if (completionStatus) data.completionStatus = completionStatus;

      execJob.updateAttributes(data, options, function (err, results) {
        /* istanbul ignore else */
        if (!err && results) {
          log.debug(TAG, 'state for execution ' + execJob.jobID + '-' + execJob.execID + ' set to ' + state);
          cb();
          eventEmitter.emit('setExecutionState', executionID, state);
        } else {
          // eslint-disable-next-line no-console
          console.error(err);
          log.error(TAG, 'Could not set state for execution ' + execJob.jobID + '-' + execJob.execID + ' to ' + state + ' ' + JSON.stringify(err));
          cb(new Error('Could not set state for execution ' + execJob.jobID + '-' + execJob.execID + ' to ' + state + ' ' + JSON.stringify(err)));
        }
      });
    }
  });
}


function markJobCompleted(executionID, completionStatus, cb) {
  if (!cb && typeof completionStatus === 'function') {
    cb = completionStatus;
    completionStatus = null;
  }
  /* istanbul ignore else */
  if (completionStatus && ( typeof completionStatus === 'number' || typeof completionStatus === 'string')) {
    // eslint-disable-next-line no-console
    console.log('WARNING: Completion status for executionID ' + executionID + ' is provided as ' + (typeof completionStatus) + '. Needs to be Object.' );
    completionStatus = { completionStatus: completionStatus};
  }
  markJobWithStatus(executionID, 'COMPLETED', completionStatus, cb);
}


function markJobFailed(executionID, completionStatus, cb) {
  if (!cb && typeof completionStatus === 'function') {
    cb = completionStatus;
    completionStatus = null;
  }
  /* istanbul ignore else */
  if (completionStatus && ( typeof completionStatus === 'number' || typeof completionStatus === 'string')) {
    // eslint-disable-next-line no-console
    console.log('WARNING: Completion status for executionID ' + executionID + ' is provided as ' + (typeof completionStatus) + '. Needs to be Object.' );
    completionStatus = { completionStatus: completionStatus};
  }
  markJobWithStatus(executionID, 'FAILED', completionStatus, cb);
}


function markJobSkipped(executionID, completionStatus, cb) {
  if (!cb && typeof completionStatus === 'function') {
    cb = completionStatus;
    completionStatus = null;
  }
  /* istanbul ignore else */
  if (completionStatus && ( typeof completionStatus === 'number' || typeof completionStatus === 'string')) {
    // eslint-disable-next-line no-console
    console.log('WARNING: Completion status for executionID ' + executionID + ' is provided as ' + (typeof completionStatus) + '. Needs to be Object.' );
    completionStatus = { completionStatus: completionStatus};
  }
  markJobWithStatus(executionID, 'SKIPPED', completionStatus, cb);
}


function markJobWithStatus(executionID, state, completionStatus, cb) {
  var TAG = 'markJobWithStatus(executionID, completionStatus, cb): ';
  var JobExecution = loopback.getModelByType('JobExecution');
  JobExecution.findOne({
    where: {
      executionID: executionID
    }
  }, options, function findCb(err, execJob) {
    /* istanbul ignore if */
    if (err) {
      // eslint-disable-next-line no-console
      console.error(err);
      log.error('Could not update state for executionID ' + executionID + ' to COMPLETED: ' + JSON.stringify(err));
      cb(err);
    } else {
      var now = Date.now();
      var data = {
        state: state,
        lastUpdateTime: new Date(now)
      };
      if (state === 'COMPLETED') {
        data.completionTime = new Date(now);
      } else if (state === 'FAILED') {
        data.failTime = new Date(now);
        data.failReason = 'Fail called from Job Module';
      }
      if (completionStatus) data.completionStatus = completionStatus;
      execJob.updateAttributes(data, options, function (err, results) {
        /* istanbul ignore else */
        if (!err && results) {
          log.debug(TAG, execJob.jobID + '-' + execJob.execID + ' state updated to ' + state);
          cb();
          eventEmitter.emit('markJobWithStatus', execJob.jobID, executionID, state);
          if (state === 'COMPLETED' && execJob.successors && typeof execJob.successors.length === 'number') {
            execJob.successors.forEach(function (successor) {
              jobSch.executeJobNow(successor.jobID, successor.parameter ? successor.parameter : null, function (err) {
                /* istanbul ignore if */
                if (err) {
                  // eslint-disable-next-line no-console
                  console.error('Error while trying to execute successor ' + successor.jobID + ' of job ' + execJob.jobID);
                  // eslint-disable-next-line no-console
                  console.error(err);
                }
              });
            });
          }
        } else {
          // eslint-disable-next-line no-console
          console.error(err);
          log.error(TAG, execJob.jobID + '-' + execJob.execID + ' state could not be updated to ' + state);
          cb(new Error(execJob.jobID + '-' + execJob.execID + ' state could not be updated to ' + state));
        }
      });
    }
  });
}


module.exports = {
  heartbeat: updateExecutionHeartbeat,
  done: markJobCompleted,
  fail: markJobFailed,
  skip: markJobSkipped
};
