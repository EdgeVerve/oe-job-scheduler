# oe-job-scheduler

## Need
Enterprise applications often require to run jobs - batch or otherwise - automatically, at pre-defined times and/or intervals. 
Such jobs are run as a background process, and may need dedicated hardware/infrastructure with its own load balancing. Typically,
these jobs don't share processing infrastructure with that of OLTP app-instances so as to minimize the impact of the job's load 
on the online performance of the application.

## Implementation
The **oe-job-scheduler** module provides the infrastructure for catering to the above need. It is implemented as an **app-list**
module for **oe-Cloud** based applications. 
It provides the ability to schedule the execution of any function exported from a node-module that can be "require"d. The *schedule*
can either be specified in the form of a string which has the cron format, or it can simply be an interval (number, in milliseconds).

The cron-like scheduling functionality is obtained using the open-source [**node-schedule**](https://www.npmjs.com/package/node-schedule) project.
**node-schedule** is a NodeJS module that exposes a ``scheduleJob()`` function for scheduling a job. 

The **oe-job-scheduler** uses this function to schedule all unscheduled and enabled jobs available in a database table called **Job**.
This happens on application startup.

To prevent jobs getting scheduled multiple times in a clustered environment, the [**oe-master-job-executor**](http://evgit/oecloud.io/oe-master-job-executor) module
is used to schedule the jobs. **oe-master-job-executor** also ensures that the *Job Sheduler* is restarted on another app-instance 
if the app-instance currently handling the scheduling goes down for any reason.

An overview of the implementation in the form of a function call-stack is available [here](http://evgit/oecloud.io/oe-job-scheduler/blob/master/JobScheduler.xlsx). 
Mouseover on each function-block for additional details.


## Features
The *Job Scheduler* has the following features - 

1. Able to schedule any number of arbitrary jobs by POSTing to a database table
2. Can schedule using the cron format or using simple interval specification
3. Jobs can be arbitrary functions exported from arbitrary node-modules
4. The *Job Scheduler* is part of the application, and runs in the same NodeJS runtime as the application
5. There is no dependency on any extra components other than the dependency on the *oe-master-job-executor* module
6. Can be enabled in standalone application as well as clustered environment
7. In a cluster, one can limit the scheduler to use specific app-instances by setting an environment variable
8. Balances the job triggers on all available "runners" in a round-robin fashion (Load balancing)
9. Facility for retry of defunct jobs and max-retry-count
10. Can manually stop and restart the *Job Scheduler* and job executions by HTTP API call
11. Executes jobs that are missed due to manual stoppage (see above) or application being down
12. Logging of all job executions with additional meta-data about execution into the database.


## Setup
To get the *Job Scheduler* feature in the application, the **oe-job-scheduler** and **oe-master-job-executor** node modules
needs to be added as *package.json* dependencies in the application. 

Also, these modules needs be added to the `server/app-list.json` file in the app. 

For e.g., 

**package.json**  (only part of the file is shown here, with relevant section in **bold**):

<pre>
...
   ...
   "dependencies": {
       ...
       ...
       ...
       "oe-workflow": "git+http://10.73.97.24/oecloud.io/oe-workflow.git#master",
       <B>"oe-master-job-executor": "git+http://10.73.97.24/oecloud.io/oe-master-job-executor.git#master",
       "oe-job-scheduler": "git+http://10.73.97.24/oecloud.io/oe-job-scheduler.git#master",</B>
       "passport": "0.2.2",
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


## Usage
Consider a job which is encapsulated in a function called ``jobFunc``, which is exported from a node module called ``jobs/end-of-day-jobs.js``.
Also, consider that this job needs to run at 11:30:15 pm each day.

The cron string for this schedule would be ``"15 30 23 * *"``

This job can be scheduled by POSTing the following data into the ``Job`` table of the application database:

```javascript
{
    "jobID" : "EOD.JobFunc",           // Mandatory. Arbitrary unique string identifier
    "schedule" : "15 30 23 * *",       // Schedule specification in cron format. Will be used if specified. Will use 'interval' if not specified.
//  "interval": 86400,                 // Ignored if 'schedule' is specified
    "enabled" : true,                  // Optional. Default: false. Needs to be true to actually schedule this job
    "mdl" : "jobs/end-of-day-jobs",    // Mandatory. The node module that exports the job function to be executed at the scheduled time
    "fn" : "jobFunc",                  // Mandatory. The job function to be executed at the scheduled time
    "retryEnabled" : true,             // Optional. Default: false. Will retry this job 'maxRetryCount' times if set to true
    "maxRetryCount" : 2                // Optional. Default: 0. Will be used if 'retryEnabled' is true
}
```

## Configuration
The *oe-job-scheduler* module can be configured via -

1. server/config.json
2. environment variables

with the following priority:  2 > 1

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