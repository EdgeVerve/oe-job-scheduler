/**
 *
 * �2016-2017 EdgeVerve Systems Limited (a fully owned Infosys subsidiary),
 * Bangalore, India. All Rights Reserved.
 *
 */

var logger = require('oe-logger');
var log = logger('job');
var path = require('path');
var msg;
var e;

module.exports = function JobFn(Job) {
  var TAG = 'JobFn(Job): ';
  Job.observe('before save', function jobBeforeSave(ctx, next) {
    var data = ctx.instance;
    // We don't want to validate during an updateAttribute
    if (!data) return next();
    if (data.mdl && data.fn) {
      try {
        var modulePath = path.resolve(process.cwd(), data.mdl);
        var m = require(modulePath);
        if (!m[data.fn]) {
          msg = 'Function ' + data.fn + ' not found in module ' + data.mdl + ' for JobID ' + data.jobID;
          log.error(TAG, msg);
          e = new Error(msg);
          e.status = 422;
          return next(e);
        } else if (typeof m[data.fn] !== 'function') {
          msg = 'Type of ' + data.fn + ' is not function in module ' + data.mdl + ' for JobID ' + data.jobID;
          log.error(TAG, msg);
          e = new Error(msg);
          e.status = 422;
          return next(e);
        }
        log.debug(TAG, 'Validation successful for ' + data.mdl + '.' + data.fn + '() for JobID ' + data.jobID);
      } catch (ex) {
        msg = 'Error while loading job-module for JobID ' + data.jobID + ': ' + ex.message;
        log.error(TAG, msg);
        e = new Error(msg);
        e.status = 422;
        return next(e);
      }
    } else {
      log.error(TAG, 'Missing job-module and/or function for JobID ' + data.jobID);
    }
    if (!data.schedule && !data.interval) {
      msg = 'Atleast one of schedule or interval must be specified for JobID ' + data.jobID;
      log.error(TAG, msg);
      e = new Error(msg);
      e.status = 422;
      return next(e);
    }
    log.debug(TAG, 'Validation successful for schedule and/or interval for JobID ' + data.jobID);
    // We reach ere only if everything is fine, i.e., all validations pass
    return next();
  });
};
