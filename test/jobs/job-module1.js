var jobSch = require('../..'); // referencing the oe-job-scheduler module under test
var log = require('oe-logger')('jobModule1');
var TAG = 'JOB-MODULE1: ';
var completionStatus1 = 0,
    completionStatus2 = 0;
var eventEmitter = require('../../lib/jobScheduler').eventEmitter;

function function1(executionID) {
    log.info(TAG, 'Starting Job-Module1.function1() execID ' + executionID.substring(30));
    eventEmitter.emit('job', 'job-module1', 'function1');

    var hbInterval = setInterval(function () {
        jobSch.heartbeat(executionID, { status: completionStatus1}, function () {});
        completionStatus1 += 25;
    }, 5000);

    setTimeout(function () {
        clearInterval(hbInterval);
        jobSch.done(executionID, { status: completionStatus1}, function () {});
    }, 20000);

    // Do work
}


function function2(executionID) {
    log.info(TAG, 'Starting Job-Module1.function2() execID ' + executionID.substring(30));
    eventEmitter.emit('job', 'job-module1', 'function2');
    // Do work
}


function function3(executionID) {
    log.info(TAG, 'Starting Job-Module1.function3() execID ' + executionID.substring(30));
    eventEmitter.emit('job', 'job-module1', 'function3');

    var hbInterval = setInterval(function () {
        jobSch.heartbeat(executionID, function () {}); // Not sending completion status
        completionStatus1 += 25;
    }, 5000);

    setTimeout(function () {
        clearInterval(hbInterval);
        jobSch.done(executionID, function () {}); // Not sending completion status
    }, 20000);

    // Do work
}


function function2(executionID) {
    log.info(TAG, 'Starting Job-Module1.function2() execID ' + executionID.substring(30));
    eventEmitter.emit('job', 'job-module1', 'function2');
    // Do work
}


function function7(executionID, parameters) {
    log.info(TAG, 'Starting Job-Module1.function7() execID ' + executionID.substring(30));
    eventEmitter.emit('job7', 'job-module1', 'function7', parameters);

    var hbInterval = setInterval(function () {
        jobSch.heartbeat(executionID, { status: completionStatus2}, function () {});
        completionStatus2 += 25;
    }, 5000);

    setTimeout(function () {
        clearInterval(hbInterval);
        jobSch.done(executionID, { status: completionStatus2}, function () {}); 
    }, 20000);

    // Do work
}

function function8(executionID) {
    log.info(TAG, 'Starting Job-Module1.function8() execID ' + executionID.substring(30));
    eventEmitter.emit('job8', 'job-module1', 'function8', executionID);

    var hbInterval = setInterval(function () {
        jobSch.heartbeat(executionID, { status: completionStatus2}, function () {});
        completionStatus2 += 25;
    }, 5000);

    var tmoutInterval = setTimeout(function () {
        clearInterval(hbInterval);
        jobSch.done(executionID, { status: completionStatus2}, function () {}); 
    }, 20000);

    setTimeout(function () {
        clearInterval(hbInterval);
        clearTimeout(tmoutInterval);
        jobSch.fail(executionID, { status: completionStatus2, msg: "Testing fail API"}, function () {});
    }, 10000);

    // Do work
}


function function9(executionID) {
    log.info(TAG, 'Starting Job-Module1.function9() execID ' + executionID.substring(30));
    eventEmitter.emit('job9', 'job-module1', 'function9', executionID);

    setTimeout(function () {
        jobSch.skip(executionID, { status: 0, msg: "Testing skip API"}, function () {});
    }, 1000);
}


function function10(executionID) {
    log.info(TAG, 'Starting Job-Module1.function10() execID ' + executionID.substring(30));
    eventEmitter.emit('job10', 'job-module1', 'function10', executionID);
}


function function11(executionID, parameters) {
    log.info(TAG, 'Starting Job-Module1.function11() execID ' + executionID.substring(30));
    eventEmitter.emit('job11', 'job-module1', 'function11', parameters);
}

function function12(executionID, parameters) {
    log.info(TAG, 'Starting Job-Module1.function12() execID ' + executionID.substring(30));
    jobSch.done(executionID, { status: "100"}, function () {}); 
    eventEmitter.emit('job12', 'job-module1', 'function12', parameters);

}

function function13(executionID, parameters) {
    log.info(TAG, 'Starting Job-Module1.function13() execID ' + executionID.substring(30));
    jobSch.done(executionID, { status: "100"}, function () {}); 
    eventEmitter.emit('job13', 'job-module1', 'function13', parameters);
}

function function14(executionID, parameters) {
    log.info(TAG, 'Starting Job-Module1.function14() execID ' + executionID.substring(30));
    jobSch.done(executionID, { status: "100"}, function () {}); 
    eventEmitter.emit('job14', 'job-module1', 'function14', parameters);
}


module.exports = {

    function1: function1,
    function2: function2,
    function7: function7,
    function8: function8,
    function9: function9,
    function10: function10,
    function11: function11,
    function12: function12,
    function13: function13,
    function14: function14,
    object1: {"some": "object"}
}