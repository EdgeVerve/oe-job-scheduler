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
is used to schedule the jobs. **oe-master-job-executor** also ensures that the *Jobs Sheduler* is restarted on another app-instance 
if the app-instance currently handling the scheduling goes down for any reason.

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







