var loopback = require('loopback');
var log = require('oe-logger')('oeJobScheduler');
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
  if (completionStatus) completionStatus = '' + completionStatus;
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
  var TAG = 'markJobCompleted(executionID, completionStatus, cb): ';
  if (!cb && typeof completionStatus === 'function') {
    cb = completionStatus;
    completionStatus = null;
  }
  /* istanbul ignore else */
  if (completionStatus) completionStatus = '' + completionStatus;
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
        state: 'COMPLETED',
        completionTime: new Date(now),
        lastUpdateTime: new Date(now)
      };
      if (completionStatus) data.completionStatus = completionStatus;
      execJob.updateAttributes(data, options, function (err, results) {
        /* istanbul ignore else */
        if (!err && results) {
          log.debug(TAG, execJob.jobID + '-' + execJob.execID + ' state updated to COMPLETED');
          cb();
        } else {
          // eslint-disable-next-line no-console
          console.error(err);
          log.error(TAG, execJob.jobID + '-' + execJob.execID + ' state could not be updated to COMPLETED');
          cb(new Error(execJob.jobID + '-' + execJob.execID + ' state could not be updated to COMPLETED'));
        }
      });
    }
  });
}

module.exports = {
  heartbeat: updateExecutionHeartbeat,
  done: markJobCompleted
};
