var log = require('oe-logger')('jobScheduler');
var TAG = 'JOB_SCHEDULER: ';

function start() {
    log.info(TAG, 'Starting Job Scheduler...');
}

function stop() {
    log.info(TAG, 'Stopping Job Scheduler...');
}

module.exports = {
    start: start,
    stop: stop
}