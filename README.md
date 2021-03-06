## Table of Contents
- [Need](#Need)
- [Implementation](#Implementation)
- [Features](#Features)
- [Setup](#Setup)
- [Usage](#Usage)
- [Manual trigger of Jobs](#Manual trigger of Jobs)
- [Chaining of Jobs](#Chaining of Jobs)
- [Configuration](#Configuration)


<a name="Need"></a>
## Need
Enterprise applications often require to run jobs - batch or otherwise - automatically, at pre-defined times and/or intervals.
Such jobs are run as a background process, and may need dedicated hardware/infrastructure with its own load balancing. Typically,
these jobs don't share processing infrastructure with that of OLTP app-instances so as to minimize the impact of the job's load
on the online performance of the application.

<a name="Implementation"></a>
## Implementation
The **oe-job-scheduler** module provides the infrastructure for catering to the above need. It is implemented as an **app-list**
module for **oe-Cloud** based applications.
It provides the ability to schedule the execution of any function exported from a node-module that can be "require"d. The *schedule*
can either be specified in the form of a string which has the cron format, or it can simply be an interval (number, in milliseconds).

The cron-like scheduling functionality is obtained using the open-source [**node-schedule**](https://www.npmjs.com/package/node-schedule) project.
**node-schedule** is a NodeJS module that exposes a ``scheduleJob()`` function for scheduling a job.

The **oe-job-scheduler** uses this function to schedule all unscheduled and enabled jobs available in a database table called **Job**.
This happens on application startup.

To prevent jobs getting scheduled multiple times in a clustered environment, the [**oe-master-job-executor**](https://github.com/EdgeVerve/oe-master-job-executor) module
is used to schedule the jobs. **oe-master-job-executor** also ensures that the *Job Sheduler* is restarted on another app-instance
if the app-instance currently handling the scheduling goes down for any reason.

An overview of the implementation in the form of a function call-stack is available [here](https://github.com/EdgeVerve/oe-job-scheduler/blob/master/JobScheduler.xlsx).
Mouseover on each function-block for additional details.

<a name="Features"></a>
## Features
The *Job Scheduler* has the following features -

1. Able to schedule any number of arbitrary jobs by POSTing to a database table
2. Can schedule using the cron format, an alternative format (start, end, rule), or using simple interval specification
3. Jobs can be arbitrary functions exported from arbitrary node-modules
4. The *Job Scheduler* is part of the application, and runs in the same NodeJS runtime as the application
5. There is no dependency on any extra components other than the dependency on the *oe-master-job-executor* module
6. Can be enabled in standalone application as well as clustered environment
7. In a cluster, one can limit the scheduler to use specific app-instances by setting an environment variable
8. Balances the job triggers on all available "runners" in a round-robin fashion (Load balancing)
9. Facility for retry of defunct jobs and max-retry-count
10. Can manually [stop and restart](https://github.com/EdgeVerve/oe-master-job-executor/blob/master/README.md#Control) the *Job Scheduler* and job executions by HTTP API call
11. Executes jobs that are missed due to manual stoppage (see above) or application being down
12. Logging of all job executions with additional meta-data about execution into the database.
13. Able to define arbitrary parameter object in the Job definition, to be passed to jobs at runtime
14. Able to skip or fail a job execution by calling appropriate functions
15. Able to trigger a defined job manually for immediate execution by function call or http request.
16. Able to chain jobs for sequential execution


<a name="Setup"></a>
## Setup
To get the *Job Scheduler* feature, the following changes need to be done in the *oe-Cloud* based application:

1. The [**oe-master-job-executor**](https://github.com/EdgeVerve/oe-master-job-executor) node module and this (**oe-job-scheduler**) module
   needs to be added as application  ``package.json`` dependencies.
2. The above modules need to be added to the `server/app-list.json` file in the app.
3. There should be one or more job functions exported from a node module which is part of the application.
4. The environment variable ``IS_JOB_RUNNER`` should be set with a value of ``true`` before the application is started.
   <pre>
   C:\> set IS_JOB_RUNNER=true   ## Windows
   C:\> node .
   </pre>
   <pre>
   $ export IS_JOB_RUNNER=true   ## Linux
   $ node .
   </pre>
   In case of an application cluster, this variable with the stated value should be set in at least one app-instance.



The code snippets below show how steps 1 and 2 can be done:

**package.json**  (only part of the file is shown here, with relevant section in **bold**):

<pre>
...
   ...
   "dependencies": {
       ...
       ...
       ...
       <B>"oe-master-job-executor": "git+https://github.com/EdgeVerve/oe-master-job-executor.git#2.0.0",
       "oe-job-scheduler": "git+https://github.com/EdgeVerve/oe-job-scheduler.git#2.0.0",</B>
       ...
       ...
</pre>

**server/app-list.json**   (Relevant section in **bold**):

<pre>
[
    {
        "path": "oe-cloud",
        "enabled": true
    },
    <b>{
        "path": "oe-master-job-executor",
        "enabled": true
    },
    {
        "path": "oe-job-scheduler",
        "enabled": true
    },</b>
	{
		"path" : "oe-workflow",
		"enabled" : true
	},
	{
        "path": "./",
        "enabled": true
    }
]
</pre>

<a name="Usage"></a>
## Usage
Consider a job which is encapsulated in a function called ``jobFunc``, which is exported from a node module called ``jobs/end-of-day-jobs.js``,
where ``jobs`` is a folder in the root of the application.

A sample ``jobs/end-of-day-jobs.js`` file is shown below:

```javascript
var jobSch = require('oe-job-scheduler');

var completionStatus, percentage = 0, errors = false;

function jobFunc(executionID, paramObj) {    // paramObj is an arbitrary parameter object defined
                                             // in the Job definition passed to the job at runtime

    // Optionally, you can check for conditions when this Job should not run, for e.g.,
    // a holiday, and skip the Job execution using the skip() function as shown below
    if( appUtil.holiday() ) {
        jobSch.skip(executionID, { status: 0, msg: "Skipping as it is a holiday today"}, function () {});
        return;  // It is important that you return to avoid executing the job despite calling skip()
                 // Another way to do this is to use the else clause for the remainder of this Job function.
    }

    // Do some work
    someArray.every(function(obj, i) {  // 'every' is used instead of 'forEach' as it allows breaking out if necessary
        // ...
        // ...
        // ...
        // ...
        // Call the heartbeat function with executionID and optionally a completion status and callback function
        // This needs to be done repeatedly and with sufficient frequency. It need not be called from a loop always.
        // It can be called from a setInterval timer as well. In that case, take care to clearInterval at the end of
        // the job, or if any exception happens.
        completionStatus = { status: percentage++ };
        jobSch.heartbeat(executionID, completionStatus, function () {});   // IMPORTANT: This call to heartbeat() need not be inside the
                                                                           // processing loop as shown here. You could have this repeatedly
                                                                           // called at a suitable frequency from a setInterval(), for example.
                                                                           // In that case, be sure to to call clearInterval() just before you
                                                                           // call jobSch.done()


        // Optionally, you can fail the current execution if some error occurs in the Job
        // by calling the fail() function as follows
        if( seriousError ) {
            jobSch.fail(executionID, { status: percentage, msg: "Failing as seriousError occurred"}, function () {});
            errors = true;
            return false;  // break the loop to avoid executing the job despite calling skip()
        } else return true;

    });

    // Call the done function once at the end of a successful job execution
    if(!errors)
        jobSch.done(executionID, completionStatus, function () {});


}

// Export the function(s)
module.exports = {
    jobFunc: jobFunc
}

```

As seen in the above sample job, the job function (``jobFunc``, in this case) needs to let the *job-scheduler* know that it is still active by calling
the ``heartbeat()`` function exposed by the *job-scheduler* module. Otherwise, the job will be marked as **failed**, and it will be retried if it is
configured to be retriable.

Similarly, a ``done()`` function needs to be called once at the end of the job execution.

The ``completionStatus`` is any object representing the current status of the job execution. It could contain a percentage of completion, for example.

Consider that this job needs to run at 11:15 pm each day. The cron string for this schedule would be ``"15 23 * * *"``

This job can be scheduled by POSTing the following data into the ``Job`` table of the application database:

```javascript
{
    "jobID" : "EOD.JobFunc",           // Mandatory. Arbitrary unique string identifier
    "schedule" : "15 23 * * *",       // Schedule specification in cron format. Will be used if specified. Will use 'interval' if not specified.
//    "schedule" : { start: startTime, end: endTime, rule: "15 23 * * *"},       // Alternate Schedule specification to include a start and end time. startTime, endTime are JavaScript Date objects. Will be used if specified. Will use 'interval' if not specified.
//  "interval": 86400,                 // Ignored if 'schedule' is specified
    "enabled" : true,                  // Optional. Default: false. Needs to be true to actually schedule this job
    "mdl" : "jobs/end-of-day-jobs",    // Mandatory. The node module that exports the job function to be executed at the scheduled time
    "fn" : "jobFunc",                  // Mandatory. The job function to be executed at the scheduled time
    "parameter": {"some": "value"},    // Optional. The value is any arbitrary object. This object will be passed to the Job at runtime
    "retryEnabled" : true,             // Optional. Default: false. Will retry this job 'maxRetryCount' times if set to true
    "maxRetryCount" : 2                // Optional. Default: 0. Will be used if 'retryEnabled' is true
}
```

An alternative way of providing the schedule is as follows:

```javascript
. . .
. . .
"schedule" : '{"start":"2021-01-01T00:00:00.000Z","end":"2022-12-31T00:00:00.000Z","rule":"* * * * *"}',       // Schedule specification using "start, end, rule" format. Will be used if specified. 
. . .
. . .
```
The above uses a start time, end time and a cron specification. 

Note that the `schedule` value is a stringified JSON. Basically, the value can be generated as `JSON.stringify({start: startTime, end: endTime, rule: "0 17 * * *"})` where `startTime` and `endTime` are Javascript `Date` objects.


<a name="Manual trigger of Jobs"></a>
## Manual trigger of Jobs
Jobs may be triggered manually once they are defined, using their JobIDs.
This can be done either by calling a function or a HTTP endpoint.

### Function
The function call to trigger a job is as follows:

```
var jobSch = require('oe-job-scheduler');

jobSch.executeJobNow(jobID, paramObj, cb);

```
where - <BR>
`jobID` - The ID of the Job that needs to be triggered immediately<BR>
`paramObj` - An optional parameter object (which will be passed to the Job function) which can override the parameter specified (if any) in the Job definition<BR>
`cb` - A callback function which has an error argument. <BR>

### HTTP endpoint
The HTTP endpoint for triggering a job is as follows:

```
POST /JobRunners/runJobNow/<jobID>

BODY
{paramObj}

```
where - <BR>
`jobID` - The ID of the Job that needs to be triggered immediately<BR>
`{paramObj}` - An optional parameter object (which will be passed to the Job function) which can override the parameter specified (if any) in the Job definition<BR>

The response will have any errors that may occur.


<a name="Chaining of Jobs"></a>
## Chaining of Jobs
Jobs may be chained together, i.e., a job can name one or more successor jobs to be triggered automatically, once it (the job defining successor(s))
completes successfully. This can be configured in the job definition of any Job.
The following example defines two jobs - a starting job with jobID ``Job1`` and a successor with jobID ``Job2``.

```javascript
[{
    "jobID" : "Job1",        // The main Job that is scheduled to run at 11:15 pm
    "schedule" : "15 23 * * *",
    "successors": [{jobID: "Job2", parameter: {some: "value", another: "one"}}],  // Array of successor objects, each element
                                                                                  // defining a jobID and an optional parameter object
    "enabled" : true,
    "mdl" : "jobs/end-of-day-jobs",
    "fn" : "jobFunc1",
    "retryEnabled" : true,
    "maxRetryCount" : 2
},
{
    "jobID": "Job2",        // The successor job
    "enabled": true,
    "schedule": "chain",                // If this job is to be used only as a successor to other jobs, then
                                        // the value needs to be "chain". Otherwise, it could be a regular cron schedule string.
    "mdl": "jobs/end-of-day-jobs",
    "fn": "jobFunc2",
    "retryEnabled": true,
    "maxRetryCount": 4
}]

```

*Notes:*<BR>
- There could be any number of successors defined for a Job.
- All successors of a job execute in parallel, ie, in an async manner.
- Optional parameters can be defined for the successor jobs, as shown in the example above
- A successor job definition can be marked as a non-scheduled job, i.e., it is to be used only as a successor. This is done by setting the value of the ``schedule`` field to "chain"
- A successor job can have its own successor(s)
- Successor(s) are executed only if the triggering job calls the ``jobSch.done()`` function.



<a name="Configuration"></a>
## Configuration
The *oe-job-scheduler* module can be configured via -

1. Default values in code (no configuration)
2. server/config.json
3. environment variables

with the following priority:  3 > 2 > 1

Priority is applicable on a per-parameter basis.

The following are the configuration parameters:

<pre>
----------------------------------------------------------------------------------------------------------------------------------------
config.json setting                         Env Variable                         type          default    Description
----------------------------------------------------------------------------------------------------------------------------------------
jobScheduler.runnerUpdateInterval          JOB_RUNNER_UPDATE_INTERVAL            number (ms)   15000      Frequency at which a global array containing
                                                                                                          available runners is updated

jobScheduler.scheduleNewJobsInterval       SCHEDULE_NEW_JOBS_INTERVAL            number (ms)   30000      Frequency at which the Jobs table is polled for
                                                                                                          new enabled jobs to schedule

jobScheduler.defunctJobsRetryInterval      DEFUNCT_JOBS_RETRY_INTERVAL           number (ms)   30000      Frequency at which JobExecution table is checked for -
                                                                                                          1. jobs that are defunct, i.e., jobs which are
                                                                                                             neither COMPLETED nor FAILED, whose heartbeats
                                                                                                             are older than DEFUNCT_JOB_TOLERANCE which is
                                                                                                             equal to (3 * DEFUNCT_JOBS_RETRY_INTERVAL)
                                                                                                          2. jobs that are missed due to manual stoppage
                                                                                                             or application being brought down.

jobScheduler.jobTriggerFailRetryDelay      JOB_TRIGGER_FAIL_RETRY_DELAY          number (ms)   5000       The delay after which a retry of a retry-able job is
                                                                                                          performed, after an unsuccessful attempt to trigger it

jobScheduler.runnerHeartbeatInterval       JOB_RUNNER_HEARTBEAT_INTERVAL         number (ms)   20000      Frequency at which the job runner heartbeat is sent

jobScheduler.runnerCleanupInterval         JOB_RUNNER_CLEANUP_INTERVAL           number (ms)   15000      Frequency at which the JobRunner table is checked for
                                                                                                          stale runners for deletion

jobScheduler.runnerRetryInterval           JOB_RUNNER_RETRY_INTERVAL             number (ms)   60000      Frequency at which an app-instance tries to become a
                                                                                                          job-runner if it fails to become one due to any reason

jobScheduler.runnerMaxHeartbeatRetryCount  JOB_RUNNER_MAX_HEARTBEAT_RETRY_COUNT  number        3          The maximum number of job-runner heartbeat failures
                                                                                                          that are tolerated before discarding a job-runner and
                                                                                                          trying to become a new job-runner again

jobScheduler.runnerRetryDelay              JOB_RUNNER_HEARTBEAT_RETRY_DELAY      number (ms)   2000       Frequency at which job-runner heartbeat is updated in
                                                                                                          the JobRunner table

----------------------------------------------------------------------------------------------------------------------------------------
</pre>


The *oe-job-scheduler* module is tested with the default values and it should work with the defaults, i.e., without any overriding configuration via the
methods mentioned above. For most scheduling needs, the defaults should suffice.


