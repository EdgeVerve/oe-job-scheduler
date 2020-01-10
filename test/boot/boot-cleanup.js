var loopback = require('loopback');
var logger = require('oe-logger');
var log = logger('boot-cleanup');
var options = {
  ignoreAutoScope: true,
  fetchAllScopes: true
};

module.exports = function bootCleanup(server, cb) {
  var TAG = 'bootCleanup()';
  /* istanbul ignore if */
  if (typeof global.it !== 'function') {
    log.debug(TAG, 'We are not is test mode. Skipping cleanup.');
    return cb();
  }

  var Job = loopback.getModelByType('Job');
  var MasterLock = loopback.getModelByType('MasterLock');
  var MasterControl = loopback.getModelByType('MasterControl');
  var JobExecution = loopback.getModelByType('JobExecution');

  JobExecution.remove({}, options, function findCb(err, res) {
    /* istanbul ignore if */
    if (err) {
      // eslint-disable-next-line no-console
      console.error(err);
      log.error(TAG, 'Could not delete JobExecution records during boot-cleanup' + JSON.stringify(err));
      return cb(err, null);
    }
    log.debug(TAG, 'deleted JobExecution records during boot-cleanup');
    Job.remove({}, options, function findCb(err, res) {
      /* istanbul ignore if */
      if (err) {
        // eslint-disable-next-line no-console
        console.error(err);
        log.error(TAG, 'Could not delete Job records during boot-cleanup' + JSON.stringify(err));
        return cb(err, null);
      }
      log.debug(TAG, 'deleted Job records during boot-cleanup');
      MasterLock.remove({}, options, function findCb(err, res) {
        /* istanbul ignore if */
        if (err) {
          // eslint-disable-next-line no-console
          console.error(err);
          log.error(TAG, 'Could not delete MasterLock records during boot-cleanup' + JSON.stringify(err));
          return cb(err, null);
        }
        log.debug(TAG, 'deleted MasterLock records during boot-cleanup');
        MasterControl.remove({}, options, function findCb(err, res) {
          /* istanbul ignore if */
          if (err) {
            // eslint-disable-next-line no-console
            console.error(err);
            log.error(TAG, 'Could not delete MasterControl records during boot-cleanup' + JSON.stringify(err));
            return cb(err, null);
          }
          log.debug(TAG, 'deleted MasterControl records during boot-cleanup');
          cb(null, null);
        });
      });
    });
  });
};
