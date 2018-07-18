var loopback = require('loopback');
var log = require('oe-logger')('oe-job-scheduler');
var TAG = 'OE-JOB-SCHEDULER: ';
var options = {
    ignoreAutoScope: true,
    fetchAllScopes: true
};

function updateExecutionHeartbeat(executionID, completionStatus, cb) {
    var state = 'RUNNING';
    if(!cb && typeof completionStatus === 'function') {
        cb = completionStatus;
        completionStatus = null;
    }
    setExecutionState(executionID, state, completionStatus, cb);
}

function setExecutionState(executionID, state, completionStatus, cb) {
    var JobExecution = loopback.getModelByType('JobExecution'); 
    JobExecution.findOne({where: {executionID: executionID}}, options, function findCb(err, execJob) {
        if(err) { 
            log.error(TAG, 'Could not set state for executionID ' + executionID + ' to '+ state +': ' + JSON.stringify(err));
            cb(err);
        }
        else {
            var data = { state: state, lastUpdateTime: Date.now()};
            if(completionStatus) data.completionStatus = completionStatus;
            
            execJob.updateAttributes(data, options, function (err, results) {
                if (!err && results) {
                    log.debug(TAG, 'state for executionID ' + executionID + ' set to '+ state);
                    cb();
                } else {
                    log.error(TAG, 'Could not set state for executionID ' + executionID + ' to '+ state);
                    cb(new Error('Could not set state for executionID ' + executionID + ' to '+ state));
                }
            });
        }
    }); 
}


function markJobCompleted(executionID, completionStatus, cb) {
    if(!cb && typeof completionStatus === 'function') {
        cb = completionStatus;
        completionStatus = null;
    }
    var JobExecution = loopback.getModelByType('JobExecution'); 
    JobExecution.findOne({where: {executionID: executionID}}, options, function findCb(err, execJob) {
        if(err) { 
            log.error('Could not update state for executionID ' + executionID + ' to COMPLETED: ' + JSON.stringify(err));
            cb(err);
        }
        else {
            var data = { state: 'COMPLETED', lastUpdateTime: Date.now()};
            if(completionStatus) data.completionStatus = completionStatus;
            execJob.updateAttributes(data, options, function (err, results) {
                if (!err && results) {
                    log.debug(TAG, execJob.jobID + '-' + execJob.execID + ' state updated to COMPLETED');
                    cb();
                } else {
                    log.error(TAG, execJob.jobID + '-' + execJob.execID + ' state could not be updated to COMPLETED');
                    cb(new Error(execJob.jobID + '-' + execJob.execID + ' state could not be updated to COMPLETED'));
                }
            });
        }
    }); 
}

module.exports = {
    hb : updateExecutionHeartbeat,
    done : markJobCompleted
}