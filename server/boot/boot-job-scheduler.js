var log = require('oe-logger')('job-scheduler.boot');
var masterJobExecutor = require('../../../oe-master-job-executor/lib/master-job-executor');
var masterJob = require('../../lib/jobScheduler.js');
var TAG = 'BOOT-JOB-SCHEDULER: ';

module.exports = function startJobScheduler(server, callback) {
    log.info(TAG, 'Starting JobScheduler Service');
    var options = {
        lockName: 'JOB-SCHEDULER',
        masterJob: masterJob,
        initDelay: 20000,
        tolerance: 10000,
        heartbeatInterval: 8000
    };
    masterJobExecutor(options);
    callback();
};