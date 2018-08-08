/**
 *
 * �2016-2017 EdgeVerve Systems Limited (a fully owned Infosys subsidiary),
 * Bangalore, India. All Rights Reserved.
 *
 */

var loopback = require('loopback');
var logger = require('oe-logger');
var log = logger('jobRunner');
var TAG = 'job-runner.js: ';
var options = {
    ignoreAutoScope: true,
    fetchAllScopes: true
};

module.exports = function JobRunnerFn(JobRunner) {
    var TAG = 'JobRunnerFn(JobRunner): ';
    JobRunner.runJob = function runJob(jobID, executionID, options, cb) {
        var TAG = 'runJob(jobID, executionID, options, cb): ';
        log.debug(TAG, 'Running '+ jobID + '-' + executionID.substring(30) +' on this Runner');
        execute(executionID, cb);
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


function execute(executionID, cb) {
    var TAG = 'execute(executionID, cb): ';
    var JobExecution = loopback.getModelByType('JobExecution'); 
    JobExecution.findOne({where: {executionID: executionID}}, options, function findCb(err, execJob) {
        if(err) {
            log.error('Could not fetch job with executionID ' + executionID + JSON.stringify(err));
            cb(err, null);
        }
        else {
            var mdl = execJob.mdl;
            var fn = execJob.fn;
            if(!mdl) {
                log.error(TAG, 'No module found for executionID ' + executionID);
                return cb(new Error('No module found for executionID ' + executionID), null);
            }
            if(!fn) {
                log.error(TAG, 'No function found for executionID ' + executionID);
                return cb(new Error('No function found for executionID ' + executionID), null);
            }
            try {
                var m = require('../../../../' + mdl);
                if(!m[fn]) {
                    log.error(TAG, 'Function ' + fn + ' not found in module ' + mdl);
                    return cb(new Error('Function ' + fn + ' not found in module ' + mdl), null);
                }
                m[fn](executionID);
                cb(null, 'OK');
            } catch(e) {
                cb(e, null);
            }
        }
    }); 
}