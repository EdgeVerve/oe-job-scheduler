/*
©2015-2016 EdgeVerve Systems Limited (a fully owned Infosys subsidiary), Bangalore, India. All Rights Reserved.
The EdgeVerve proprietary software program ("Program"), is protected by copyrights laws, international treaties and other pending or existing intellectual property rights in India, the United States and other countries.
The Program may contain/reference third party or open source components, the rights to which continue to remain with the applicable third party licensors or the open source community as the case may be and nothing here transfers the rights to the third party and open source components, except as expressly permitted.
Any unauthorized reproduction, storage, transmission in any form or by any means (including without limitation to electronic, mechanical, printing, photocopying, recording or  otherwise), or any distribution of this Program, or any portion of it, may result in severe civil and criminal penalties, and will be prosecuted to the maximum extent possible under the law.
*/
/**
 * 
 * This is a mocha test script for the oe-job-scheduler app-list module for oe-Cloud
 * based applications.
 * 
 * @file test.js
 * @author Ajith Vasudevan
 */
var app = require('oe-cloud');
var loopback = require('loopback');
var log = require('oe-logger')('jobSchedulerTest');
var chalk = require('chalk');
var chai = require('chai');
chai.use(require('chai-things'));
var expect = chai.expect;
var defaults = require('superagent-defaults');
var supertest = require('supertest');
var api = defaults(supertest(app));

// Boot the application instance
app.boot(__dirname, function (err) {
    if (err) {
        console.log(chalk.red(err));
        log.error(err);
        process.eit(1);
    }
    app.start();
    app.emit('test-start');
});


// Test case code begins here:
describe(chalk.blue('oe-job-scheduler-test Started'), function (done) {
    var Job = loopback.getModelByType('Job');
    var JobRunner = loopback.getModelByType('JobRunner');
    var JobExecution = loopback.getModelByType('JobExecution');
    var options = {
        ignoreAutoScope: true,
        fetchAllScopes: true
    };
    var jobSch = require('../lib/jobScheduler');
    var eventEmitter = jobSch.eventEmitter;
    var jshConfig = jobSch.config;
    console.log(jshConfig);
    log.debug("Starting oe-job-scheduler-test");

    this.timeout(600000); // setting the timeout to 10 minutes so as to be able to keep running
    // the application for as long as required to do all  tests

    var basePath;

    // The param function of before() is called before everything else in the test-case.
    // The param function's callback (done) is called to signal that the test-case can
    // proceed to the next step. 
    // In the param function, we subscribe to the app's 'test-start' event. We do some 
    // initial setup and call done() from within this event's callback so as to make sure
    // the initial setup is performed after all the boot scripts have run, and we proceed to the
    // next step in the test only after the initial setup is done.
    before('wait for boot scripts to complete', function (done) {
        var TAG = 'before()';
        log.debug("Starting " + TAG);

        // The 'test-start' event is fired after boot of app. In its callback,
        // we perform some initial setup for our tests
        eventEmitter.once('became-job-runner', function () {
            var TAG = "'became-job-runner' event callback";
            log.debug(TAG);

            // Initial Setup begins here:
            // initialize variables
            basePath = app.get('restApiRoot');
            done();
        });

    });


    // This Mocha function is called after all 'it()' tests are run
    // We do some cleanup here
    after('after all', function (done) {
        var TAG = 'after()';
        console.log(chalk.yellow("Starting " + TAG));
        log.debug(TAG, 'After all tests');
        done();
        setTimeout(function () {
            process.eit(0);
        }, 1000);
    });



    it('should fail to schedule Job with missing function', function (done) {
        var TAG = "[it should fail to schedule Job with missing function]";
        console.log(chalk.yellow("[" + new Date().toISOString() + "]      : ", "Starting " + TAG));
        var data = [{
            "jobID": "JOB3",
            "enabled": true,
            "schedule": "* * * * *",
            "mdl": "test/jobs/job-module1",
            "retryEnabled": true,
            "maxRetryCount": 2,
            "scheduled": false
        }]; // function not specified
        Job.create(data, options, function (err, res) {
            expect(err).to.be.defined;
            expect(res).not.to.be.defined;
            done();
        });
    });

    it('should fail to schedule Job with missing job-module', function (done) {
        var TAG = "[it should fail to schedule Job with missing job-module]";
        console.log(chalk.yellow("[" + new Date().toISOString() + "]      : ", "Starting " + TAG));
        var data = [{
            "jobID": "JOB4",
            "enabled": true,
            "schedule": "* * * * *",
            "fn": "function4",
            "retryEnabled": true,
            "maxRetryCount": 2,
            "scheduled": false
        }]; // job-module not specified
        Job.create(data, options, function (err, res) {
            expect(err).to.be.defined;
            expect(res).not.to.be.defined;
            done();
        });
    });


    it('should fail to schedule Job with invalid function', function (done) {
        var TAG = "[it should fail to schedule Job with invalid function]";
        console.log(chalk.yellow("[" + new Date().toISOString() + "]      : ", "Starting " + TAG));
        var data = [{
            "jobID": "JOB5",
            "enabled": true,
            "schedule": "* * * * *",
            "mdl": "test/jobs/job-module1",
            "fn": "function4",
            "retryEnabled": true,
            "maxRetryCount": 2,
            "scheduled": false
        }]; // invalid function specified
        Job.create(data, options, function (err, res) {
            expect(err).to.be.defined;
            expect(res).not.to.be.defined;
            done();
        });
    });


    it('should fail to schedule Job with non-existent job-module', function (done) {
        var TAG = "[it should fail to schedule Job with non-existent job-module]";
        console.log(chalk.yellow("[" + new Date().toISOString() + "]      : ", "Starting " + TAG));
        var data = [{
            "jobID": "JOB6",
            "enabled": true,
            "schedule": "* * * * *",
            "mdl": "test/jobs/job-module2",
            "fn": "function6",
            "retryEnabled": true,
            "maxRetryCount": 2,
            "scheduled": false
        }]; // non-existent job-module specified
        Job.create(data, options, function (err, res) {
            expect(err).to.be.defined;
            expect(res).not.to.be.defined;
            done();
        });
    });


    it('should fail to schedule Job with missing schedule and interval', function (done) {
        var TAG = "[it should fail to schedule Job with missing schedule and interval]";
        console.log(chalk.yellow("[" + new Date().toISOString() + "]      : ", "Starting " + TAG));
        var data = [{
            "jobID": "JOB7",
            "enabled": true,
            "mdl": "test/jobs/job-module1",
            "fn": "function1",
            "retryEnabled": true,
            "maxRetryCount": 2,
            "scheduled": false
        }]; // missing schedule and interval
        Job.create(data, options, function (err, res) {
            expect(err).to.be.defined;
            expect(res).not.to.be.defined;
            done();
        });
    });


    it('should fail to schedule Job with fn passed being non-function object', function (done) {
        console.log("********************************************* Database:", JobExecution.dataSource.connector.name);
        var TAG = "[it should fail to schedule Job with fn passed being non-function object]";
        console.log(chalk.yellow("[" + new Date().toISOString() + "]      : ", "Starting  " + TAG));
        var data = [{
            "jobID": "JOB8",
            "enabled": true,
            "mdl": "test/jobs/job-module1",
            "fn": "object1",
            "retryEnabled": true,
            "maxRetryCount": 2,
            "schedule": "* * * * *",
            "scheduled": false
        }]; // typeof fn !== 'function'
        Job.create(data, options, function (err, res) {
            expect(err).to.be.defined;
            expect(res).not.to.be.defined;
            done();
        });
    });


    it('should schedule a Job which skips using schJob.skip()', function (done) {
        this.timeout(300000);
        var TAG = "[ should schedule a Job which skips using schJob.skip() ]";
        console.log(chalk.yellow("[" + new Date().toISOString() + "]      : ", "Starting " + TAG));
        var data = [{
                "jobID": "JOB9",
                "enabled": true,
                "schedule": "* * * * *",
                "mdl": "test/jobs/job-module1",
                "fn": "function9",
                "retryEnabled": true,
                "maxRetryCount": 2,
                "scheduled": false
            }
        ];

        var execID1 = [], execID2 = [], state2 = [];

        Job.create(data, options, function (err, res) {
            if(err) return done(err);
            else if(!res) return done(new Error('Could not create Job'));

            eventEmitter.on('job9', function (mdl, fn, executionID1) {
                execID1.push(executionID1);
            });
    
            eventEmitter.on('markJobWithStatus', function (jobID, executionID2, state) {
                if(jobID === 'JOB9') {
                    execID2.push(executionID2);
                    state2.push(state);
                }
            });

            setTimeout(function() {
                eventEmitter.removeAllListeners('job9');
                eventEmitter.removeAllListeners('markJobWithStatus');
                expect(execID1[0]).to.equal(execID2[0]);
                expect(state2[0]).to.equal('SKIPPED');
                var excID = execID1[0];
                execID1.shift();                              // Checking if the first element of execID1
                expect(execID1.indexOf(excID)).to.equal(-1);  // is not repeated in the execID1 array
                done();
            }, 120000);
        });
    });


    it('should schedule a Job which fails using schJob.fail()', function (done) {
        this.timeout(300000);
        var TAG = "[ should schedule a Job which fails using schJob.fail() ]";
        console.log(chalk.yellow("[" + new Date().toISOString() + "]      : ", "Starting " + TAG));
        var data = [{
                "jobID": "JOB8",
                "enabled": true,
                "schedule": "* * * * *",
                "mdl": "test/jobs/job-module1",
                "fn": "function8",
                "retryEnabled": true,
                "maxRetryCount": 2,
                "scheduled": false
            }
        ];

        var execID1 = [], execID2 = [], state2 = [];

        Job.create(data, options, function (err, res) {
            if(err) return done(err);
            if(!res) return done(new Error('Could not create Job'));

            eventEmitter.on('job8', function (mdl, fn, executionID1) {
                execID1.push(executionID1);
            });
    
            eventEmitter.on('markJobWithStatus', function (jobID, executionID2, state) {
                if(jobID === 'JOB8') {
                    execID2.push(executionID2);
                    state2.push(state);
                }
            });

            setTimeout(function() {
                eventEmitter.removeAllListeners('job8');
                eventEmitter.removeAllListeners('markJobWithStatus');
                expect(execID1[0]).to.equal(execID2[0]);
                expect(state2[0]).to.equal('FAILED');
                done();
            }, 120000);
        });

    });


    it('should schedule a Job with parameter object successfully', function (done) {
        this.timeout(10 * jshConfig.scheduleNewJobsInterval);
        var TAG = "[should schedule a Job with parameter object successfully ]";
        console.log(chalk.yellow("[" + new Date().toISOString() + "]      : ", "Starting " + TAG));
        var data = [{
                "jobID": "JOB7",
                "enabled": true,
                "schedule": "* * * * *",
                "mdl": "test/jobs/job-module1",
                "parameter": {"some": "property"},
                "fn": "function7",
                "retryEnabled": true,
                "maxRetryCount": 2,
                "scheduled": false
            }
        ];

        Job.create(data, options, function (err, res) {
            if(err) return done(err);
            else if(!res) return done(new Error('Could not create Job'));

            eventEmitter.once('job7', function (mdl, fn, parameters) {
                expect(parameters).to.be.defined;
                expect(parameters.some).to.be.defined;
                expect(parameters.some).to.equal("property");
                setTimeout(done, 60000);
            });

        });
    });


    it('should trigger a scheduled Job manually with Javascript API', function (done) {
        this.timeout(10 * jshConfig.scheduleNewJobsInterval);
        var TAG = "[should execute a scheduled Job manually with Javascript API ]";
        console.log(chalk.yellow("[" + new Date().toISOString() + "]      : ", "Starting " + TAG));
        var data = [{
                "jobID": "JOB10",
                "enabled": true,
                "schedule": "0 0 1 1 *",                   // Schedule for midnight, 1st Jan
                "mdl": "test/jobs/job-module1",
                "fn": "function10",
                "retryEnabled": true,
                "maxRetryCount": 2,
                "scheduled": false
            }
        ];

        eventEmitter.once('job10', function (mdl, fn) {
            setTimeout(done, 5000);
        });

        Job.create(data, options, function (err, res) {
            if(err) return done(err);
            else if(!res) return done(new Error('Could not create Job'));

            setTimeout(function() {
                jobSch.executeJobNow("JOB10", null, function(err) {
                    if(err) console.log(err);
                });
            }, 30000);
        });
    });


    it('should trigger a scheduled Job manually with http API', function (done) {
        this.timeout(10 * jshConfig.scheduleNewJobsInterval);
        var TAG = "[should execute a scheduled Job manually with http API ]";
        console.log(chalk.yellow("[" + new Date().toISOString() + "]      : ", "Starting " + TAG));

        eventEmitter.once('job10', function (mdl, fn) {
            setTimeout(done, 5000);
        });

        var postUrl = basePath + '/JobRunners/runJobNow/JOB10'; 
        api.set('Content-Type', 'application/json')
        .post(postUrl)
        .send()
        .end(function (err, response) {
            expect(err).not.to.be.defined; // Expect no error upon calling API
            expect(response.statusCode).to.equal(200); // Expect 200 OK response
        });
    });



    it('should trigger a scheduled Job manually with Javascript API and with default parameters', function (done) {
        this.timeout(10 * jshConfig.scheduleNewJobsInterval);
        var TAG = "[should trigger a scheduled Job manually with Javascript API and with default parameters ]";
        console.log(chalk.yellow("[" + new Date().toISOString() + "]      : ", "Starting " + TAG));
        var data = [{
                "jobID": "JOB11",
                "enabled": true,
                "schedule": "0 0 1 1 *",                   // Schedule for midnight, 1st Jan
                "mdl": "test/jobs/job-module1",
                "fn": "function11",
                "parameter": {"some": "property1"},
                "retryEnabled": true,
                "maxRetryCount": 2,
                "scheduled": false
            }
        ];

        eventEmitter.once('job11', function (mdl, fn, parameters) {
            expect(parameters).to.be.defined;
            expect(parameters.some).to.be.defined;
            expect(parameters.some).to.equal("property1");
            setTimeout(done, 5000);
        });

        Job.create(data, options, function (err, res) {
            if(err) return done(err);
            else if(!res) return done(new Error('Could not create Job'));

            setTimeout(function() {
                jobSch.executeJobNow("JOB11", null, function(err) {
                    if(err) console.log(err);
                });
            }, 30000);
        });
    });


    it('should trigger a scheduled Job manually with http API and with default parameters', function (done) {
        this.timeout(10 * jshConfig.scheduleNewJobsInterval);
        var TAG = "[should trigger a scheduled Job manually with http API and with default parameters ]";
        console.log(chalk.yellow("[" + new Date().toISOString() + "]      : ", "Starting " + TAG));

        eventEmitter.once('job11', function (mdl, fn, parameters) {
            expect(parameters).to.be.defined;
            expect(parameters.some).to.be.defined;
            expect(parameters.some).to.equal("property1");
            setTimeout(done, 5000);
        });

        var postUrl = basePath + '/JobRunners/runJobNow/JOB11'; 
        api.set('Content-Type', 'application/json')
        .post(postUrl)
        .send()
        .end(function (err, response) {
            expect(err).not.to.be.defined; // Expect no error upon calling API
            expect(response.statusCode).to.equal(200); // Expect 200 OK response
        });
    });



    it('should trigger a scheduled Job manually with Javascript API and with overriding parameters', function (done) {
        this.timeout(10 * jshConfig.scheduleNewJobsInterval);
        var TAG = "[should trigger a scheduled Job manually with Javascript API and with overriding parameters]";
        console.log(chalk.yellow("[" + new Date().toISOString() + "]      : ", "Starting " + TAG));

        eventEmitter.once('job11', function (mdl, fn, parameters) {
            expect(parameters).to.be.defined;
            expect(parameters.another).to.be.defined;
            expect(parameters.another).to.equal("property2");
            setTimeout(done, 5000);
        });

        jobSch.executeJobNow("JOB11", {another: "property2"}, function(err) {
            if(err) console.log(err);
        });

    });


    it('should trigger a scheduled Job manually with http API and with overriding parameters', function (done) {
        this.timeout(10 * jshConfig.scheduleNewJobsInterval);
        var TAG = "[should trigger a scheduled Job manually with http API and with overriding parameters ]";
        console.log(chalk.yellow("[" + new Date().toISOString() + "]      : ", "Starting " + TAG));

        eventEmitter.once('job11', function (mdl, fn, parameters) {
            expect(parameters).to.be.defined;
            expect(parameters.another).to.be.defined;
            expect(parameters.another).to.equal("property2");
            setTimeout(done, 5000);
        });

        var postUrl = basePath + '/JobRunners/runJobNow/JOB11'; 
        api.set('Content-Type', 'application/json')
        .post(postUrl)
        .send({another: "property2"})
        .end(function (err, response) {
            expect(err).not.to.be.defined; // Expect no error upon calling API
            expect(response.statusCode).to.equal(200); // Expect 200 OK response
        });
    });


    it('should schedule Jobs successfully', function (done) {
        this.timeout(2 * jshConfig.scheduleNewJobsInterval);
        var TAG = "[it should schedule a Job successfully within " + (2 * jshConfig.scheduleNewJobsInterval / 1000) + "s ]";
        console.log(chalk.yellow("[" + new Date().toISOString() + "]      : ", "Starting " + TAG));
        var data = [{
                "jobID": "JOB1",
                "enabled": true,
                "schedule": "* * * * *",
                "mdl": "test/jobs/job-module1",
                "fn": "function1",
                "retryEnabled": true,
                "maxRetryCount": 2,
                "scheduled": false
            },
            {
                "jobID": "JOB2",
                "enabled": true,
                "schedule": "* * * * *",
                "mdl": "test/jobs/job-module1",
                "fn": "function3",
                "retryEnabled": true,
                "maxRetryCount": 2,
                "scheduled": false
            },
            {
                "jobID": "JOB3",
                "enabled": true,
                "schedule": "* * * * *",
                "mdl": "test/jobs/job-module1",
                "fn": "function1",
                "retryEnabled": false,
                "maxRetryCount": 2,
                "scheduled": false
            },
            {
                "jobID": "JOB4",
                "enabled": true,
                "schedule": "* * * * *",
                "mdl": "test/jobs/job-module1",
                "fn": "function2",
                "retryEnabled": true,
                "maxRetryCount": 4,
                "scheduled": false
            },
            {
                "jobID": "JOB5",
                "enabled": true,
                "interval": 45000,
                "mdl": "test/jobs/job-module1",
                "fn": "function1",
                "retryEnabled": true,
                "maxRetryCount": 4,
                "scheduled": false
            }
        ];

        Job.create(data, options, function (err, res) {
            expect(err).not.to.be.defined;
            expect(res).not.to.be.undefined;
            eventEmitter.once('job-scheduler-scheduled-new-job', function (jobID, schedule) {
                console.log('job-scheduler-scheduled-new-job event fired for jobID ' + jobID + ' with schedule ' + schedule);
                done();
            });

        });
    });




    it('should start a scheduled Job successfully', function (done) {
        this.timeout(10 * jshConfig.scheduleNewJobsInterval);
        var TAG = "[it should start a scheduled Job successfully within " + (10 * jshConfig.scheduleNewJobsInterval / 1000) + "s ]";
        console.log(chalk.yellow("[" + new Date().toISOString() + "]      : ", "Starting " + TAG));
        eventEmitter.once('job', function (mdl, fn) {
            console.log('job event fired for ' + mdl + '.' + fn);
            done();
        });
    });




    it('should stop JobScheduler Master when /api/MasterControls/disable is called', function (done) {
        this.timeout(120000 + (4 * jshConfig.scheduleNewJobsInterval));
        var TAG = "[it should stop JobScheduler Master when /api/MasterControls/disable is called within " + (120000 + (4 * jshConfig.scheduleNewJobsInterval / 1000)) + "s ]";
        console.log(chalk.yellow("[" + new Date().toISOString() + "]      : ", "Starting " + TAG));

        eventEmitter.once('job-scheduler-stopped', function () {
            console.log('job-scheduler-stopped event fired');
            done();
        });

        setTimeout(function() {
            var postUrl = basePath + '/MasterControls/disable'; // API to disable Master
            api.set('Content-Type', 'application/json')
                .post(postUrl)
                .send({
                    lockName: 'JOB-SCHEDULER',
                    reason: 'testing'
                }) // payload for disable API
                .end(function (err, response) {
                    expect(err).not.to.be.defined; // Expect no error upon calling API
                    expect(response.statusCode).to.equal(200); // Expect 200 OK response
                });
        }, 120000);  // Delay stopping for future tests
        
    });


    it('should restart JobScheduler Master with /api/MasterControls/enable and verify execution of missed job', function (done) {
        this.timeout(360000);
        var TAG = "[it should restart JobScheduler Master with /api/MasterControls/enable and verify execution of missed job within " + (360000 / 1000) + "s ]";
        console.log(chalk.yellow("[" + new Date().toISOString() + "]      : ", "Starting " + TAG));

        eventEmitter.once('execute-missed-job', function (jobID) {
            console.log('execute-missed-job event fired for jobID ' + jobID);
            done();
        });

        setTimeout(function() {
            var postUrl = basePath + '/MasterControls/enable'; // API to enable Master
            api.set('Content-Type', 'application/json')
                .post(postUrl)
                .send({
                    lockName: 'JOB-SCHEDULER'
                }) // payload for enable API
                .end(function (err, response) {
                    expect(err).not.to.be.defined; // Expect no error upon calling API
                    expect(response.statusCode).to.equal(200); // Expect 200 OK response
                });            
        }, 180000);
    });


    it('should retry a job that has no heartbeat', function (done) {
        this.timeout(7 * jshConfig.scheduleNewJobsInterval);
        var TAG = "[it should retry a job that has no heartbeat within " + (7 * jshConfig.scheduleNewJobsInterval / 1000) + "s ]";
        console.log(chalk.yellow("[" + new Date().toISOString() + "]      : ", "Starting " + TAG));
        eventEmitter.once('retry-job', function (jobID) {
            console.log('retry-job event fired for JobID ' + jobID);
            done();
        });
    });


    it('should retry becoming a runner after a runner heartbeat fails', function (done) {
        this.timeout((jshConfig.runnerMaxHeartbeatRetryCount + 2) * jshConfig.runnerHeartbeatInterval);
        var TAG = "[it should retry becoming a runner after a runner heartbeat fails within " + ((jshConfig.runnerMaxHeartbeatRetryCount + 1) * jshConfig.runnerHeartbeatInterval / 1000) + "s ]";
        console.log(chalk.yellow("[" + new Date().toISOString() + "]      : ", "Starting " + TAG));
        JobRunner.remove({}, options, function findCb(err, res) {
            expect(err).not.to.be.defined;
            console.log('runner test: After deletion, res:', res);
            eventEmitter.once('became-job-runner', function (instanceID) {
                console.log('became-job-runner event fired for JobID ' + instanceID);
                done();
            });
        });
    });


    it('should schedule Chained Jobs and execute them successfully', function (done) {
        this.timeout(10 * jshConfig.scheduleNewJobsInterval);
        var TAG = "[it should schedule Chained Jobs successfully within " + (10 * jshConfig.scheduleNewJobsInterval / 1000) + "s ]";
        console.log(chalk.yellow("[" + new Date().toISOString() + "]      : ", "Starting " + TAG));
        var data = [{
                "jobID": "JOB12",
                "enabled": true,
                "schedule": "* * * * *",
                "successors": [{jobID: "JOB13", parameter: {param: 13}}],
                "mdl": "test/jobs/job-module1",
                "fn": "function12",
                "retryEnabled": true,
                "maxRetryCount": 2,
                "scheduled": false
            },
            {
                "jobID": "JOB13",
                "enabled": true,
                "schedule": "chain",
                "successors": [{jobID: "JOB14", parameter: {param: 14}}],
                "mdl": "test/jobs/job-module1",
                "fn": "function13",
                "retryEnabled": true,
                "maxRetryCount": 4,
                "scheduled": false
            },
            {
                "jobID": "JOB14",
                "enabled": true,
                "schedule": "chain",
                "mdl": "test/jobs/job-module1",
                "fn": "function14",
                "retryEnabled": true,
                "maxRetryCount": 4,
                "scheduled": false
            }
        ];

        Job.create(data, options, function (err, res) {
            expect(err).not.to.be.defined;
            expect(res).not.to.be.undefined;

            eventEmitter.once('job14', function (mdl, fn, parameters) {
                expect(parameters).to.be.defined;
                expect(parameters.param).to.be.defined;
                expect(parameters.param).to.equal(14);
                done();
            });

        });
    });


});