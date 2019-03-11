/**
 *
 * �2016-2017 EdgeVerve Systems Limited (a fully owned Infosys subsidiary),
 * Bangalore, India. All Rights Reserved.
 *
 */

var loopback = require('loopback');
var logger = require('oe-logger');
var jobSch = require('../../lib/jobScheduler');
var log = logger('jobRunner');
var path = require('path');
var options = {
  ignoreAutoScope: true,
  fetchAllScopes: true
};

module.exports = function JobRunnerFn(JobRunner) {
  JobRunner.runJob = function runJob(jobID, executionID, opts, cb) {
    // istanbul ignore else
    if (!cb && typeof opts === 'function') cb = opts;
    var TAG = 'runJob(jobID, executionID, options, cb): ';
    log.debug(TAG, 'Running ' + jobID + '-' + executionID.substring(30) + ' on this Runner');
    execute(executionID, cb);
  };

  JobRunner.remoteMethod('runJob', {
    description: 'runs a job on this runner',
    accessType: 'EXECUTE',
    accepts: [{
      arg: 'jobID',
      type: 'string',
      required: true
    }, {
      arg: 'execID',
      type: 'string',
      required: true
    }],
    http: {
      path: '/runJob/:jobID/:execID',
      verb: 'get'
    },
    returns: [{
      arg: 'body',
      type: 'object',
      root: true
    }]
  });


  JobRunner.runJobNow = function runJobNow(jobID, params, opts, cb) {
    // istanbul ignore else
    if (!cb && typeof opts === 'function') cb = opts;
    var TAG = 'runJobNow(jobID, params, opts, cb): ';
    log.debug(TAG, 'Running Job ' + jobID + ' on this Runner');
    cb(null, {status: 'Job ' + jobID + ' triggered'});
    if (params && Object.keys(params).length === 0) {params = null;}
    jobSch.executeJobNow(jobID, params, function (err) {
      if (err) {
        // eslint-disable-next-line no-console
        console.error(err);
      }
    });
  };

  JobRunner.remoteMethod('runJobNow', {
    description: 'runs a job on this runner manually',
    accessType: 'WRITE',
    accepts: [{
      arg: 'jobID',
      type: 'string',
      required: true
    }, {
      arg: 'params',
      type: 'object',
      http: { source: 'body' },
      required: false
    }],
    http: {
      path: '/runJobNow/:jobID',
      verb: 'post'
    },
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
  JobExecution.findOne({
    where: {
      executionID: executionID
    }
  }, options, function findCb(err, execJob) {
    /* istanbul ignore if */
    if (err) {
      // eslint-disable-next-line no-console
      console.error(err);
      log.error('Could not fetch job with executionID ' + executionID + JSON.stringify(err));
      cb(err, null);
    } else {
      var mdl = execJob.mdl;
      var fn = execJob.fn;
      var parameter = execJob.parameter;
      /* istanbul ignore if */
      if (!mdl) {
        // console.log('No module found for executionID ' + executionID);
        log.error(TAG, 'No module found for executionID ' + executionID);
        return cb(new Error('No module found for executionID ' + executionID), null);
      }
      /* istanbul ignore if */
      if (!fn) {
        // console.log('No function found for executionID ' + executionID);
        log.error(TAG, 'No function found for executionID ' + executionID);
        return cb(new Error('No function found for executionID ' + executionID), null);
      }
      var modulePath;
      try {
        modulePath = path.resolve(process.cwd(), mdl);
        log.debug(TAG, 'Trying to load module at ' + modulePath);
        var m = require(modulePath);
        /* istanbul ignore if */
        if (!m[fn]) {
          log.error(TAG, 'Function ' + fn + ' not found in module ' + mdl);
          return cb(new Error('Function ' + fn + ' not found in module ' + mdl), null);
        }
        m[fn](executionID, parameter);
        cb(null, 'OK');
      } catch (e) {
        // istanbul ignore next
        log.error(TAG, 'Error while loading ' + modulePath + ': ' + e.message);
        // istanbul ignore next
        cb(e, null);
      }
    }
  });
}
