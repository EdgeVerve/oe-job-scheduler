# oe-node-red module for oe-cloud based applications

## Introduction
**Node-RED** has been a feature of *oe-cloud* framework for some time now, and it has been widely adopted for its extreme ease of use. 
In order to take advantage of new features introduced in newer versions of *Node-RED*, like *projects* (linking *Node-RED* flows with *Git*), 
we need to be able to upgrade *Node-RED* easily and seamlessly.
To this end, *Node-RED* has been separated from the core *oe-cloud* framework and the *Node-RED* integration is now implemented as an 
optional "app-list" module for the *oe-cloud*-based app. This new module is called **oe-node-red**.

## About the module
**oe-node-red** is a nodejs module for *Node-RED* integration with *oe-cloud*, which means that this module is the only dependency required by an
*oe-cloud* based application to get the *Node-RED* feature.

This module adds a boot-script for starting Node-RED as part of the loopback app boot-up. It also adds a few loopback models to the app for managing Node-RED data.

The *oe-node-red* module also manages other dependencies like *loopback-connector-for-Node-RED*, and *Node-RED* itself. As of now, the *Node-RED* 
dependency version is changed from 16.x to 18.x, which has various improvements including `projects`.


### About the new `projects` feature

`projects` are meant to be enabled in development environment only. In production, you'd typically 
disable projects. While in development mode, `projects` are enabled by default, and flows that are created using the UI are 
saved locally, in the filesystem, and you have the option of connecting all flows to a single Git 
repository through the Node-RED UI. Standard Git features such as check in, check out, commit,
history, etc., are available via the Node-RED UI. Optionally, `projects` may be turned off via configuration.

See here for more info: https://nodered.org/docs/user-guide/projects/


## How to add Node-RED feature in oe-cloud -based app?

To get the *Node-RED* feature in the application, the **oe-node-red** node module needs to be added 
as a *package.json* dependency in the application. 

Also, the module needs be added to the `server/app-list.json` file in the app. 

For e.g.,

<pre>
package.json  (only part of the file is shown here, with relevant section in bold):


   ...
   ...
   "dependencies": {
       ...
       ...
       ...
       "oe-workflow": "git+http://10.73.97.24/oecloud.io/oe-workflow.git#master",
       <b>"oe-node-red": "git+http://10.73.97.24/oecloud.io/oe-node-red.git#master",</b>
       "passport": "0.2.2",
       ...
       ...

</pre>

<pre>
server/app-list.json   (Relevant section in bold):

[
    {
        "path": "oe-cloud",
        "enabled": true
    },
    <b>{
        "path": "oe-node-red",
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


### Configuration

The *oe-node-red* module is configured from two files - 

* server/config.json
* server/node-red-settings.js

#### server/config.json settings

The *oe-node-red* configuration settings in `config.json` are used for high level control, like enabling/disabling *Node-RED*, 
enabling and setting up Node-RED-admin roles, etc., 

All *oe-node-red* configuration parameters in this file are optional. 

The following are the *oe-node-red* configuration settings possible in the application's `server/config.json` file:
<pre>
-------------------------------------------------------------------------------------------------------------------
setting                  type           default (if not defined)  Description          
-------------------------------------------------------------------------------------------------------------------
disableNodered           boolean        false                     Use this to turn off Node-RED (despite having the *oe-node-red* module)
                                                                  by setting this parameter to true. Default is false, i.e., Node-RED is
                                                                  enabled by default. See notes below for corresponding environment variable.
                                                                  
enableNodeRedAdminRole   boolean        false                     Use this to allow only users having certain roles to access the Node-RED UI
                                                                  by setting this parameter to true. Default is false, which allows all users
                                                                  access to Node-RED UI.
                                                                  
nodeRedAdminRoles        string array   ["NODE_RED_ADMIN"]        Use this to setup the names of the roles which have access to the Node-RED UI. 
                                                                  This setting is used only if enableNodeRedAdminRole is true.
                                                                  
nodeRedUserScope         boolean        false                     Use this to configure the basis for Node-RED flow isolation (for access).
                                                                  Setting this to true causes the flows to be isolated based on user. So user A
                                                                  can see and edit only flows created by him, but cannot access user B's flows.
                                                                  Setting this to false (the default) causes flows to be isolated based on tenant.
//
// The following are used to override the corresponding defaults provided by the oe-node-red module, 
// when server/node-red-settings.js is absent. These will be ignored if server/node-red-settings.js is present.
//

nodeRedUserDir           string         nodered/                  Same as 'userDir' of node-red-settings.js
                                    

disableNodeRedProjects   boolean        false                     If set to true, disables Node-RED projects. If set to anything else, enables 
                                                                  Node-RED projects. See notes below for corresponding environment variable.

flowProjectsDir          string         nodered/                  Sets the location where Node-RED stores the flow Git projects. 
                                                                  Applicable when Node-RED projects are enabled.                                                                  
                                                                  
-------------------------------------------------------------------------------------------------------------------                                                                  
</pre>


#### server/node-red-settings.js

`server/node-red-settings.js` supports the same parameter settings as Node-RED's `settings.js` file. 

This file (`server/node-red-settings.js`) is optional. In its absence, sane defaults are provided 
by the *oe-node-red* module. 

*If this file is present, all Node-RED configuration is taken from this file and no defaults will be provided, except for the storage module.*

Some of the important settings possible in this file are documented here: https://nodered.org/docs/configuration

A sample `server/node-red-settings.js` file is provided below:

```javascript
module.exports = {                                  // All defaults mentioned below are applicable only   
                                                    // if server/node-red-settings.js is **not present**
                                             
  uiPort: process.env.NODE_RED_PORT || 3001,        // default: 3001
  httpRequestTimeout: 120000,                       // default: not set
  editorTheme: {       
    projects: {
      enabled: true                                 // default: true
    }
  },
  projectsDir: "nodered/",                          // default: nodered/
  httpAdminRoot: '/red',                            // default: /red
  httpNodeRoot: '/redapi',                          // default: /red
  userDir: 'nodered/',                              // default: nodered/
  nodesDir: '../nodes',                             // default: ../nodes
  flowFile: 'node-red-flows.json',                  // default: 'node-red-flows.json'
  flowFilePretty: true,                             // default: true
  credentialSecret: "my-random-string",             // default: "my-random-string"
  functionGlobalContext: {                          // default: {
    loopback: require('loopback'),                  //            loopback: require('loopback'),
    logger: require('oe-logger')('node-red-flow')   //            logger: require('oe-logger')('node-red-flow')
  }                                                //          }
}

```

#### Notes

As mentioned above, Node-RED integration can be disabled from the server/config.json. It can also be disabled by 
setting the environment variable:
```console
DISABLE_NODE_RED=true   (or 1)
```

If `server/node-red-settings.js` is not present, the defaults that are provided are as in the comments above.
In this case, you can set `nodeRedUserDir`, `disableNodeRedProjects`, and `flowProjectsDir` in `server/config.json`
to override the corresponding defaults, as shown in the `server/config.json settings` section above. 

If `server/node-red-settings.js` is not present, `projects` can be enabled/disabled from `server/config.json settings`
as mentioned above. This `project` setting can further be overridden using an environment variable:
```console
DISABLE_NODE_RED_PROJECTS=true   (or 1)
```

If **production** mode is enabled by setting the environment variable `NODE_ENV` to `production`, then *Node-RED*'s storage 
module is set to the *oe-cloud* specific database storage module (`'../../lib/oe-node-red-storage'`), and *Node-RED flows* 
are saved to the database, with multi-tenancy. 

`projects` cannot be enabled in **production** mode. If they are enabled in configuration while in this mode, they will
be disabled with a warning in the logs.

If `projects` are enabled (in non-production mode), then *Node-RED* uses its default filesystem storage. 
*Flows* on the filesystem won't be multi-tenant. All *flows* from the filesystem will be accessible to any user.

## Migration from oe-cloud v 1.2.0/1.3.0
In this new implementation of *Node-RED* integration, flow-nodes are now stored as separate records, one record per node.
So, a flow that contains 10 nodes would be stored as 10 records plus an extra node of type "flow", making a total of 11 records
in the database (*NodeRedFlow* table). This is in contrast to the earlier (*oe-cloud v 1.2.0/1.3.0*) implementation
where all flows (and their nodes) are stored as a single record in the database. The old storage format will not work with
the new *Node-RED* integration implementation.

To address this, the following migration strategy can be adopted:

1. Before upgrading to the new *oe-cloud* that includes the new *Node-RED* integration implementation, Login to your application and open the *Node-RED* UI.
2. Export your *Node-RED* flows to the clipboard using the ``Menu --> Export --> Clipboard`` option.
3. Save the contents of the clipboard to a local file, with filename same as the tab name.
4. Repeat steps 2 and 3 for all tabs in your *Node-RED* interface, at the end of which you should have as many local files as there are tabs in your *Node-RED* UI.
5. Delete all your *Node-RED* flow-data from the database (*NodeRedFlow* table) by deleting all your flows (from all tabs) using your *Node-RED* UI.
6. Upgrade to the latest version of oe-cloud which includes the new implementation of *Node-RED* integration.
7. Login to your application and open the new *Node-RED* UI
8. Import the flows from each of the files created in step 3 back into *Node-RED*, naming the tabs the same as the filename, using the ``Menu --> Import --> Clipboard`` option
9. Run a sanity test on your flows.





