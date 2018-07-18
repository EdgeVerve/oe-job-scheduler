/**
 *
 * �2016-2017 EdgeVerve Systems Limited (a fully owned Infosys subsidiary),
 * Bangalore, India. All Rights Reserved.
 *
 */

var loopback = require('loopback');
var logger = require('oe-logger');
var log = logger('job-runner');
var TAG = 'JOB-RUNNER: ';
var options = {
    ignoreAutoScope: true,
    fetchAllScopes: true
};

module.exports = function JobRunnerFn(JobRunner) {

    JobRunner.runJob = function runJob(jobID, executionID, options, cb) {
        log.info(TAG, 'Running '+ jobID + '-' + executionID +' on this Runner');
        execute(executionID);
        cb(null, {message: 'Job Started'});
    };

    JobRunner.remoteMethod('runJob', {
        description: 'runs a job on this runner',
        accessType: 'EXECUTE',
        accepts: [{arg: 'jobID', type: 'string', required: true}, {arg: 'execID', type: 'string', required: true}],
        http: {path: '/runJob/:jobID/:execID', verb: 'get'},
        returns: [{
            arg: 'body',
            type: 'object',
            root: true
        }]
    });
};


function execute(executionID) {
    var JobExecution = loopback.getModelByType('JobExecution'); 
    JobExecution.findOne({where: {executionID: executionID}}, options, function findCb(err, execJob) {
        if(err) log.error('Could not fetch job with executionID ' + executionID + JSON.stringify(err));
        else {
            var mdl = execJob.mdl;
            var fn = execJob.fn;
            if(!mdl) {
                log.error(TAG, 'No module found for executionID ' + executionID);
                return;
            }
            if(!fn) {
                log.error(TAG, 'No function found for executionID ' + executionID);
                return;
            }
            try {
                var m = require('../../../../' + mdl);
                if(!m[fn]) {
                    log.error(TAG, 'Function ' + fn + ' not found in module ' + mdl);
                    return;
                }
                m[fn](executionID);
            } catch(e) {
                log.error(TAG, 'Could not execute ' + mdl + '.' + fn + ' ' + JSON.stringify(e));
            }
        }
    }); 
}