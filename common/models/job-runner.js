/**
 *
 * �2016-2017 EdgeVerve Systems Limited (a fully owned Infosys subsidiary),
 * Bangalore, India. All Rights Reserved.
 *
 */
var logger = require('oe-logger');
var log = logger('job-runner');
var TAG = 'JOB-RUNNER: ';

module.exports = function JobRunnerFn(JobRunner) {

    JobRunner.runJob = function runJob(jobID, options, cb) {
        log.info(TAG, 'Running '+ jobID +' on this Runner');
        cb(null, {message: 'Job Started'});
    };

    JobRunner.remoteMethod('runJob', {
        description: 'runs a job on this runner',
        accessType: 'EXECUTE',
        accepts: {arg: 'jobID', type: 'string', required: true},
        http: {path: '/runJob/:jobID', verb: 'get'},
        returns: [{
            arg: 'body',
            type: 'object',
            root: true
        }]
    });
};