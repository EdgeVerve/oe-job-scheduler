var masterJob = require('../../lib/jobScheduler.js');

module.exports = function startJobScheduler(server, callback) {
    masterJob.init(server, callback);
};
