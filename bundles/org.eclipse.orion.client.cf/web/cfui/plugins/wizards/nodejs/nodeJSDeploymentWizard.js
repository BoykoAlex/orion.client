/*global parent window document define orion setTimeout*/
	
var uiTestFunc = null;

define(["orion/bootstrap", "orion/xhr", 'orion/webui/littlelib', 'orion/Deferred', 'orion/cfui/cFClient', 'orion/PageUtil', 'orion/selection',
	'orion/URITemplate', 'orion/PageLinks', 'orion/preferences', 'cfui/cfUtil', 'orion/objects', 'orion/widgets/input/ComboTextInput',
	'orion/webui/Wizard', 'orion/i18nUtil'], 
		function(mBootstrap, xhr, lib, Deferred, CFClient, PageUtil, mSelection, URITemplate, PageLinks, Preferences, mCfUtil, objects, ComboTextInput, Wizard, i18nUtil) {

	var cloudManageUrl;
	
	mBootstrap.startup().then(
		function(core) {
			
			var pageParams = PageUtil.matchResourceParameters();
			var deployResource = decodeURIComponent(pageParams.resource);
			
			var serviceRegistry = core.serviceRegistry;
			var cFService = new CFClient.CFService(serviceRegistry);
			
			/* initial message */
			document.getElementById('title').appendChild(document.createTextNode("Configure Application Deployment")); //$NON-NLS-1$//$NON-NLS-0$
			var msgContainer = document.getElementById('messageContainer'); //$NON-NLS-0$
			var msgLabel = document.getElementById('messageLabel'); //$NON-NLS-0$
			
			/* pages */
			var page0, page1, page2, page3;
			
			/* other variables */
			var commonPane, target, orgsDropdown, spacesDropdown, appsInput, appsDropdown, hostInput,
				hostDropdown, servicesList, servicesDropdown, saveManifestCheckbox, command, path, instances,
				buildpack, memory, memoryUnit, timeout;
			
			var deployResourceJSON = JSON.parse(deployResource);
			var plan = deployResourceJSON.Plan;
			
			var relativeFilePath = new URL(deployResourceJSON.ContentLocation).href;
			var orionHomeUrl = new URL(PageLinks.getOrionHome());
			
			if(relativeFilePath.indexOf(orionHomeUrl.origin) === 0)
				relativeFilePath = relativeFilePath.substring(orionHomeUrl.origin.length);
			
			if(relativeFilePath.indexOf(orionHomeUrl.pathname) === 0)
				relativeFilePath = relativeFilePath.substring(orionHomeUrl.pathname.length);
			
			var manifestContents = {applications: [{}]};
			var manifestInfo = {};

			function showMessage(message){
				msgLabel.appendChild(document.createTextNode(message));
				msgContainer.classList.add("showing"); //$NON-NLS-0$
			}
			
			function hideMessage(){
				lib.empty(msgLabel);
				msgContainer.classList.remove("showing"); //$NON-NLS-0$
			}
			
			var selection;
			
			showMessage("Loading deployment settings...");
			
			/* register hacked pref service */
			var temp = document.createElement('a');
			temp.href = "../prefs/user";
			var location = temp.href;
			
			function PreferencesProvider(location) {
				this.location = location;
			}

			PreferencesProvider.prototype = {
				get: function(name) {
					return xhr("GET", this.location + name, {
						headers: {
							"Orion-Version": "1"
						},
						timeout: 15000,
						log: false
					}).then(function(result) {
						return result.response ? JSON.parse(result.response) : null;
					});
				},
				put: function(name, data) {
					return xhr("PUT", this.location + name, {
						data: JSON.stringify(data),
						headers: {
							"Orion-Version": "1"
						},
						contentType: "application/json;charset=UTF-8",
						timeout: 15000
					}).then(function(result) {
						return result.response ? JSON.parse(result.response) : null;
					});
				},
				remove: function(name, key){
					return xhr("DELETE", this.location + name +"?key=" + key, {
						headers: {
							"Orion-Version": "1"
						},
						contentType: "application/json;charset=UTF-8",
						timeout: 15000
					}).then(function(result) {
						return result.response ? JSON.parse(result.response) : null;
					});
				}
			};
			
			var service = new PreferencesProvider(location);
			serviceRegistry.registerService("orion.core.preference.provider", service, {});
			
			// This is code to ensure the first visit to orion works
			// we read settings and wait for the plugin registry to fully startup before continuing
			var preferences = new Preferences.PreferencesService(serviceRegistry);
			
			// cancel button
			var closeFrame = function() {
				 window.parent.postMessage(JSON.stringify({pageService: "orion.page.delegatedUI", 
					 source: "org.eclipse.orion.client.cf.deploy.uritemplate", cancelled: true}), "*");
			};
			
			var getManifestInfo = function(results){
				var ret = objects.clone(manifestContents);
				if(!manifestContents.applications.length>0){
					manifestContents.applications.push({});
				}
				if(results.name){
					manifestContents.applications[0].name = results.name;
				}
				if(results.host){
					manifestContents.applications[0].host = results.host;
				}
				if(results.services){
					manifestContents.applications[0].services = results.services;
				}
				if(typeof results.command === "string"){
					if(results.command){
						manifestContents.applications[0].command = results.command;
					} else {
						delete manifestContents.applications[0].command;
					}
				}
				if(typeof results.path === "string"){
					if(results.path){
						manifestContents.applications[0].path = results.path;
					} else {
						delete manifestContents.applications[0].path;
					}
				}
				if(typeof results.buildpack === "string"){
					if(results.buildpack){
						manifestContents.applications[0].buildpack = results.buildpack;
					} else {
						delete manifestContents.applications[0].buildpack;
					}
				}
				if(typeof results.memory === "string"){
					if(results.memory){
						manifestContents.applications[0].memory = results.memory;
					} else {
						delete manifestContents.applications[0].memory;
					}
				}
				if(typeof results.instances !== "undefined"){
					if(results.instances){
						manifestContents.applications[0].instances = results.instances;
					} else {
						delete manifestContents.applications[0].instances;
					}
				}
				if(typeof results.timeout !== "undefined"){
					if(results.timeout){
						manifestContents.applications[0].timeout = results.timeout;
					} else {
						delete manifestContents.applications[0].timeout;
					}
				}
				return ret;
			};
			
			var doAction = function(results) {
				showMessage("Deploying...");
				selection.getSelection(
					function(selection) {
						if(selection===null || selection.length===0){
							closeFrame();
							return;
						}
						
						if(orgsDropdown){
							orgsDropdown.disabled = true;
						}
						if(spacesDropdown){
							spacesDropdown.disabled = true;
						}
						
						var editLocation = new URL("../edit/edit.html#" + deployResourceJSON.ContentLocation, window.location.href);
						
						var manifest = getManifestInfo(results);
						
						cFService.pushApp(selection, null, decodeURIComponent(deployResourceJSON.ContentLocation + deployResourceJSON.AppPath), manifest, saveManifestCheckbox.checked).then(
							function(result){
								var appName = result.App.name || result.App.entity.name;
								var host = (result.Route !== undefined ? (result.Route.host || result.Route.entity.host) : undefined);
								var launchConfName = appName + " on " + result.Target.Space.Name + " / " + result.Target.Org.Name;
								postMsg({
									CheckState: true,
									ToSave: {
										ConfigurationName: launchConfName,
										Parameters: {
											Target: {
												Url: result.Target.Url,
												Org: result.Target.Org.Name,
												Space: result.Target.Space.Name
											},
											Name: appName,
											Timeout: (result.Timeout !== undefined) ? result.Timeout : undefined
										},
										Url: (result.Route !== undefined) ? "http://" + host + "." + result.Domain : undefined,
										UrlTitle: (result.Route !== undefined) ? appName : undefined,
										Type: "Cloud Foundry",
										ManageUrl: result.ManageUrl,
										Path: deployResourceJSON.AppPath
									},
									Message: "See Manual Deployment Information in the [root folder page](" + editLocation.href + ") to view and manage [" + launchConfName + "](" + result.ManageUrl + ")"
								});
							}, function(error){
								postError(error);
							}
						);
					}
				);
			};
			
			document.getElementById('closeDialog').addEventListener('click', closeFrame); //$NON-NLS-1$ //$NON-NLS-0$
			 
			// allow frame to be dragged by title bar
			var that=this;
			var iframe = window.frameElement;
		    setTimeout(function() {
				var titleBar = document.getElementById('titleBar');
				titleBar.addEventListener('mousedown', function(e) {
					that._dragging=true;
					if (titleBar.setCapture) {
						titleBar.setCapture();
					}
					that.start = {screenX: e.screenX,screenY: e.screenY};
				});
				titleBar.addEventListener('mousemove', function(e) {
					if (that._dragging) {
						var dx = e.screenX - that.start.screenX;
						var dy = e.screenY - that.start.screenY;
						that.start.screenX = e.screenX;
						that.start.screenY = e.screenY;
						var x = parseInt(iframe.style.left) + dx;
						var y = parseInt(iframe.style.top) + dy;
						iframe.style.left = x+"px";
						iframe.style.top = y+"px";
					}
				});
				titleBar.addEventListener('mouseup', function(e) {
					that._dragging=false;
					if (titleBar.releaseCapture) {
						titleBar.releaseCapture();
					}
				});
		    });
		    
		    commonPane = new Wizard.WizardPage({
		    	template: '<div class="manifest formTable" id="manifest"></div>',
		    	render: function(){
		    		var manifestElement = document.getElementById("manifest");
					saveManifestCheckbox = document.createElement("input");
					saveManifestCheckbox.type = "checkbox";
					saveManifestCheckbox.id = "saveManifest";
					saveManifestCheckbox.checked = "checked";
					manifestElement.appendChild(saveManifestCheckbox);
					var label = document.createElement("label");
					label.className = "manifestLabel";
					label.appendChild(document.createTextNode("Save to manifest file: "));
					var manifestFolder = deployResourceJSON.AppPath || "";
					manifestFolder = manifestFolder.substring(0, manifestFolder.lastIndexOf("/")+1);
					label.appendChild(document.createTextNode("/" + manifestFolder + "manifest.yml"));
					manifestElement.appendChild(label);
		    	},
		    	getResults: function(){
		    		var ret = {}
		    		ret.saveManifest = saveManifestCheckbox.checked;
		    		return ret;
		    	}
		    });
		    
		    page0 = new Wizard.WizardPage({
		    	template: "<div class=\"deployMessage\" id=\"planMessage\"></div>",
		    	
		    	render: function(){
		    		this.wizard.validate();
		    		cFService.getOrgs(target).then(function(resp){
		    			hideMessage();
		    			
		    			var org = resp.Orgs[0];
		    			var space = org.Spaces[0];
		    			
		    			target.Org = org.Name;
		    			target.Space = space.Name;
		    			
		    			selection = new mSelection.Selection(serviceRegistry, "orion.Spaces.selection"); //$NON-NLS-0$
		    			selection.setSelections(target);
		    			
		    			var messageTemplate = "<b>${0}</b> is going to be deployed as a <b>node.js</b> application to <b>${1}</b> @ <b>${2}</b>."+
		    				"Click \"Deploy\" to proceed.";
		    			var message = i18nUtil.formatMessage(messageTemplate, manifestInfo.name, space.Name, org.Name);
		    			
		    			var messageDiv = document.getElementById("planMessage");
			    		messageDiv.innerHTML = message;
		    		}, function(error){
		    			postError(error);
		    		});
		    	},
		    	validate: function(setValid){
		    		setValid(true);
		    		return;
		    	},
		    	getResults: function(){
		    		return {};
		    	}
		    });
		    
		    page1 = new Wizard.WizardPage({
		    	template: "<table class=\"formTable\">"+
				"<tr>"+
					"<td id=\"orgsLabel\" class=\"label\"></td>"+
					"<td id=\"orgs\" class=\"selectCell\"></td>"+
				"</tr>"+
				"<tr>"+
					"<td id=\"spacesLabel\" class=\"label\"></td>"+
					"<td id=\"spaces\" class=\"selectCell\"></td>"+
				"</tr>"+
				"<tr>"+
					"<td id=\"nameLabel\" class=\"label\"></td>"+
					"<td id=\"name\" class=\"selectCell\"></td>"+
				"</tr>"+
				"<tr>"+
					"<td id=\"hostLabel\" class=\"label\"></td>"+
					"<td id=\"host\" class=\"selectCell\"></td>"+
				"</tr>"+
			"</table>",
				render: function(){
					this.wizard.validate();
					cloudManageUrl = target.ManageUrl;
					
					showMessage("Loading deployment settings...");
					cFService.getOrgs(target).then(
						function(result2){
							hideMessage();
																
							document.getElementById("orgsLabel").appendChild(document.createTextNode("Organization*:"));
		
							orgsDropdown = document.createElement("select");
							result2.Orgs.forEach(function(org){
								var option = document.createElement("option");
								option.appendChild(document.createTextNode(org.Name));
								option.org = org;
								orgsDropdown.appendChild(option);
							});
							
							orgsDropdown.onchange = function(event){
								var selectedOrg = event.target.value;
								loadTargets(selectedOrg);
							};
							
							document.getElementById("orgs").appendChild(orgsDropdown);
																
							var targets = {};
							result2.Orgs.forEach(function(org){
								targets[org.Name] = [];
								if (org.Spaces)
									org.Spaces.forEach(function(space){
										var newTarget = {};
										newTarget.Url = target.Url;
										if (cloudManageUrl)
											newTarget.ManageUrl = cloudManageUrl;
										newTarget.Org = org.Name;
										newTarget.Space = space.Name;
										targets[org.Name].push(newTarget);
									});
							});
							
							selection = new mSelection.Selection(serviceRegistry, "orion.Spaces.selection"); //$NON-NLS-0$
							selection.addEventListener("selectionChanged", function(){this.validate()}.bind(this.wizard));
		
								document.getElementById("spacesLabel").appendChild(document.createTextNode("Space*:"));
		
								spacesDropdown = document.createElement("select");
								
								function setSelection(){
									if(!spacesDropdown.value){
										selection.setSelections();
									} else {
										var orgTargets = targets[orgsDropdown.value];
										if(!orgTargets){
											selection.setSelections();
										} else {
											for(var i=0; i<orgTargets.length; i++){
												if(orgTargets[i].Space == spacesDropdown.value){
													selection.setSelections(orgTargets[i]);
													break;
												}
											}
										}
									}
								}
								
								spacesDropdown.onchange = function(event){
									setSelection();
									selection.getSelection(
										function(selection) {
											loadApplications(selection);
											loadHosts(selection);
										});
								};
																						
								document.getElementById("spaces").appendChild(spacesDropdown);
							
							function loadTargets(org){
								
								var targetsToDisplay = targets[org];
								lib.empty(spacesDropdown);
								targetsToDisplay.forEach(function(target){
									var option = document.createElement("option");
									option.appendChild(document.createTextNode(target.Space));
									option.target = target;
									spacesDropdown.appendChild(option);
								});
								setSelection();
								selection.getSelection(
									function(selection) {
										loadApplications(selection);
										loadHosts(selection);
									});
							}
							
							var appsList = [];
							var appsDeferred;
							function loadApplications(target){
								appsDeferred = cFService.getApps(target);
								appsDeferred.then(function(apps){
									appsList = [];
									if(apps.Apps){
										apps.Apps.forEach(function(app){
											appsList.push(app.Name);
										});
									}
								}.bind(this));
							}
							
							var routesList = [];
							var routesDeferred;
							function loadHosts(target){
								routesDeferred = cFService.getRoutes(target);
								routesDeferred.then(function(routes){
									if(routes.Routes){
										routesList = [];
										routes.Routes.forEach(function(route){
											routesList.push(route.Host);
										});
									}
								}.bind(this));							
							}
							
							document.getElementById("nameLabel").appendChild(document.createTextNode("Application Name*:"));
							
							appsDropdown = new ComboTextInput({
								id: "applicationNameTextInput", //$NON-NLS-0$
								parentNode: document.getElementById("name"),
								insertBeforeNode: this._replaceWrapper,
								hasButton: false,
								hasInputCompletion: true,
								serviceRegistry: this._serviceRegistry,
								defaultRecentEntryProposalProvider: function(onItem){
									appsDeferred.then(function(){
										var ret = [];
										appsList.forEach(function(app){
											if(!app) return;
											ret.push({type: "proposal", label: app, value: app});
										});
										onItem(ret);									
									}.bind(this));
								}
							});
							
							appsInput= appsDropdown.getTextInputNode();						
							appsInput.onkeyup = function(){this.validate();}.bind(this.wizard);
							appsInput.addEventListener("focus",function(){this.validate();}.bind(this.wizard));
							
							if(manifestInfo.name){
								appsInput.value = manifestInfo.name;
							}
							
							document.getElementById("hostLabel").appendChild(document.createTextNode("Host:"));
							
							
							hostDropdown = new ComboTextInput({
								id: "applicationRouteTextInput", //$NON-NLS-0$
								parentNode: document.getElementById("host"),
								insertBeforeNode: this._replaceWrapper,
								hasButton: false,
								hasInputCompletion: true,
								serviceRegistry: this._serviceRegistry,
								defaultRecentEntryProposalProvider: function(onItem){
									routesDeferred.then(function(){
										var ret = [];
										routesList.forEach(function(route){
											if(!route) return;
											ret.push({type: "proposal", label: route, value: route});
										});
										onItem(ret);
									}.bind(this));
								}
							});
							
							hostInput = hostDropdown.getTextInputNode();
							hostInput.value = manifestInfo.host || manifestInfo.name || "";
							
							loadTargets(orgsDropdown.value);
							
						}.bind(this), function(error){
							postError(error);
						}
					);
			    },
			    validate: function(setValid) {
					if(!selection){
						setValid(false);
						return;
					}
					if(!appsInput || !appsInput.value){
						setValid(false);
						return;
					}
					selection.getSelection(function(selection) {
						if(selection===null || selection.length===0){
							setValid(false);
							return;
						}
						if(appsInput.value){
							setValid(true);
						} else {
							setValid(true);
						}
					});
				},
				getResults: function(){
					var res = {};
					if(appsInput && appsInput.value){
						res.name = appsInput.value;
					}
					if(hostInput && hostInput.value){
						res.host = hostInput.value;
					}
					return res;
				}
			});
		    
		page2 = new Wizard.WizardPage({
			template:'<table class="formTable">'+
				'<tr>'+
					'<td id="allServicesLabel" class="label" colspan="3"></td>'+
				'</tr>'+
				'<tr>'+
					'<td id="servicesLabel" class="label"></td>'+
					'<td id="servicesLabel">&nbsp;</td>'+
					'<td id="servicesAdded" class="label"></td>'+
				'</tr>'+
				'<tr>'+
					'<td id="servicesDropdown" class="listCell"></td>'+
					'<td id="servicesAddRemoveButtonsCol" class="listCell"></td>'+
					'<td id="servicesList" class="listCell"></td>'+
				'</tr>'+
			'</table>',
			render: function(){
	    		document.getElementById("allServicesLabel").appendChild(document.createTextNode("Add services from the list."));
	    		document.getElementById("servicesLabel").appendChild(document.createTextNode("Existing Services:"));
	    		servicesDropdown = document.createElement("select");
	    		servicesDropdown.size = 8;
	    		servicesDropdown.multiple="multiple";
		    	document.getElementById("servicesDropdown").appendChild(servicesDropdown);
		    	
		    	document.getElementById("servicesAdded").appendChild(document.createTextNode("Application Services:"));
	    		servicesList = document.createElement("select");
	    		servicesList.multiple="multiple";
	    		servicesList.size = 8;
		    	document.getElementById("servicesList").appendChild(servicesList);
		    	
		    	var addButton = document.createElement("button");
		    	addButton.appendChild(document.createTextNode(">"));
		    	addButton.className = "orionButton commandButton";
		    	var removeButton = document.createElement("button");
		    	removeButton.className = "orionButton commandButton";
		    	removeButton.appendChild(document.createTextNode("<"));
		    	document.getElementById("servicesAddRemoveButtonsCol").appendChild(removeButton);
		    	document.getElementById("servicesAddRemoveButtonsCol").appendChild(addButton);
		    	
		    	addButton.addEventListener('click', function(){
		    		for(var i=servicesDropdown.options.length-1; i>=0; i--){
		    			var option = servicesDropdown.options[i];
							if(option.selected){
								servicesDropdown.removeChild(option);
								servicesList.appendChild(option);
							}
						}
					});
					
				removeButton.addEventListener('click', function(){
		    		for(var i=servicesList.options.length-1; i>=0; i--){
		    			var option = servicesList.options[i];
							if(option.selected){
								servicesList.removeChild(option);
								servicesDropdown.appendChild(option);
							}
						}
					});
					
				var services = manifestInfo.services;
				if(manifestInfo.services){
					if(!Array.isArray(services)){
						if(typeof services === "object"){
							services = Object.keys(services);
							if(services.lengh > 0){
								document.getElementById("allServicesLabel").appendChild(document.createElement("br"));
								document.getElementById("allServicesLabel").appendChild(document.createTextNode("Convert my manifest.yml file to v6"));
							}
						} else {
							services = [];
						}
					}
	    			services.forEach(function(serviceName){
		    			var serviceOption = document.createElement("option");
		    			if(typeof serviceName !== "string"){
		    				return;
		    			}
						serviceOption.appendChild(document.createTextNode(serviceName));
						serviceOption.service = serviceName;
						serviceOption.id = "service_" + serviceName;
						servicesList.appendChild(serviceOption);	
	    			});
	    		}
	    		
	    		showMessage("Loading services...");
		    	cFService.getServices(target).then(function(servicesResp){
		    		hideMessage();
		    		var servicesToChooseFrom = [];
		    		
					if(servicesResp.Children){
						servicesResp.Children.forEach(function(service){
							if(services && services.some(function(manService){return manService === service.Name;})){
								
							} else {
								servicesToChooseFrom.push(service.Name);
							}
						});
					}
						
		    		servicesToChooseFrom.forEach(function(serviceName){
						var serviceOption = document.createElement("option");
						serviceOption.appendChild(document.createTextNode(serviceName));
						serviceOption.service = serviceName;
						serviceOption.id = "service_" + serviceName;
						servicesDropdown.appendChild(serviceOption);
		    		});
		    		
		    	}.bind(this), postError);
		    },
		    getResults: function(){
		    	var ret = {};
		    	if(servicesList){
					var services = [];
					for(var i=0; i<servicesList.options.length; i++){
						services.push(servicesList.options[i].value);
					}
					ret.services = services;
				}
				return ret;
		    }
		    });
		    
		    
		     page3 = new Wizard.WizardPage({
		    	template: '<table class="formTable">'+
				'<tr>'+
					'<td id="commandLabel" class="label"></td>'+
					'<td id="command" class="selectCell"></td>'+
				'</tr>'+
				'<tr>'+
					'<td id="pathLabel" class="label"></td>'+
					'<td id="path" class="selectCell"></td>'+
				'</tr>'+
				'<tr>'+
					'<td id="buildpackLabel" class="label"></td>'+
					'<td id="buildpack" class="selectCell"></td>'+
				'</tr>'+
				'<tr>'+
					'<td id="memoryLabel" class="label"></td>'+
					'<td id="memory" class="selectCell"></td>'+
				'</tr>'+
				'<tr>'+
					'<td id="instancesLabel" class="label"></td>'+
					'<td id="instances" class="selectCell"></td>'+
				'</tr>'+
				'<tr>'+
					'<td id="timeoutLabel" class="label"></td>'+
					'<td id="timeout" class="selectCell"></td>'+
				'</tr>'+
			'</table>',
		    	render: function(){
			    	document.getElementById("commandLabel").appendChild(document.createTextNode("Command:"));
			    	command = document.createElement("input");
			    	if(manifestInfo.command){
			    		command.value = manifestInfo.command;
			    	}
			    	document.getElementById("command").appendChild(command);
			    	document.getElementById("pathLabel").appendChild(document.createTextNode("Path:"));
			    	path = document.createElement("input");
			    	if(manifestInfo.path){
			    		path.value = manifestInfo.path;
			    	}
			    	document.getElementById("path").appendChild(path);
			    	document.getElementById("buildpackLabel").appendChild(document.createTextNode("Buildpack Url:"));
			    	buildpack = document.createElement("input");
			    	if(manifestInfo.buildpack){
			    		buildpack.value = manifestInfo.buildpack;
			    	}
			    	document.getElementById("buildpack").appendChild(buildpack);
			    	document.getElementById("memoryLabel").appendChild(document.createTextNode("Memory:"));
			    	memory = document.createElement("input");
			    	memory.id = "memoryInput";
			    	memory.type = "number";
			    	memory.min = "0";
			    	memoryUnit = document.createElement("select");
			    	memoryUnit.id = "memoryUnit";
					var option = document.createElement("option");
					option.appendChild(document.createTextNode("MB"));
					option.value = "MB";
					memoryUnit.appendChild(option);
					option = document.createElement("option");
					option.appendChild(document.createTextNode("GB"));
					option.value = "GB";
					memoryUnit.appendChild(option);
			    	if(manifestInfo.memory){
			    		if(manifestInfo.memory.toUpperCase().indexOf("M")>0 || manifestInfo.memory.toUpperCase().indexOf("G")>0){
			    			var indexOfUnit = manifestInfo.memory.toUpperCase().indexOf("M") > 0 ? manifestInfo.memory.toUpperCase().indexOf("M") : manifestInfo.memory.toUpperCase().indexOf("G");
							memory.value = manifestInfo.memory.substring(0, indexOfUnit);
							var unit = manifestInfo.memory.substring(indexOfUnit).toUpperCase();
							if(unit.trim().length === 1){
								unit += "B";
							}
							memoryUnit.value = unit;
			    		}
			    	}
			    	document.getElementById("memory").appendChild(memory);
			    	document.getElementById("memory").appendChild(memoryUnit);
			    	
			    	document.getElementById("instancesLabel").appendChild(document.createTextNode("Instances:"));
			    	instances = document.createElement("input");
			    	instances.type = "number";
			    	instances.min = "0";
			    	if(manifestInfo.instances){
			    		instances.value = manifestInfo.instances;
			    	}
			    	document.getElementById("instances").appendChild(instances);
			    	document.getElementById("timeoutLabel").appendChild(document.createTextNode("Timeout (sec):"));
			    	timeout = document.createElement("input");
			    	timeout.type = "number";
			    	timeout.min = "0";
			    	if(manifestInfo.timeout){
			    		timeout.value = manifestInfo.timeout;
			    	}
			    	document.getElementById("timeout").appendChild(timeout);
			    },
			    getResults: function(){
			    var ret = {};
			    if(command){
			    	ret.command = command.value;
			    }
			    if(buildpack){
					ret.buildpack = buildpack.value;
				}
				if(memory){
					ret.memory = memory.value ? memory.value + memoryUnit.value : "";
				}
				if(instances){
					ret.instances = instances.value;
				}
				if(timeout){
					ret.timeout = timeout.value;
				}
				if(path){
					ret.path = path.value;
				}
		    	return ret;
			    }
		    });

		    //
		    function loadScreen(){
				var configAdmin = serviceRegistry.getService('orion.cm.configadmin'); //$NON-NLS-0$
				configAdmin.getConfiguration("app.settings").then(
					function(config) {
						 // get target and app, then do push and open application
						
						getTarget(cFService, config, preferences).then(
							function(targetResp){
								target = targetResp;
								var wizard = new Wizard.Wizard({
									parent: "wizard",
									pages: [page0, page1, page2, page3],
									commonPane: commonPane,
									onSubmit: doAction,
									onCancel: closeFrame,
									buttonNames: {ok: "Deploy"},
									size: {width: "370px", height: "180px"}
								});
							}, function(error){
								postError(error);
							}
						);
					}.bind(this)
				);
			}
		    
		    manifestContents = plan.Manifest;
		    manifestInfo = manifestContents.applications[0];
		    loadScreen();
		}
	);
	
	// make sure target is set and it matches the url in settings
	function getTarget(cFService, config, preferences) {
		return mCfUtil.getTarget(preferences);
	}

	function postMsg(status) {
		window.parent.postMessage(JSON.stringify({pageService: "orion.page.delegatedUI", 
			 source: "org.eclipse.orion.client.cf.deploy.uritemplate", 
			 status: status}), "*");
	}
	
	function postError(error) {
		if(error.Message){
			if (error.Message.indexOf("The host is taken")===0){
//				error.Message = error.Message.replace("The host is taken", "The Bluemix route");
				error.Message = "The host is already in use by another application. Please check the host/domain in the manifest file.";
			}
		}
		
		if (error.HttpCode === 404){
			error = {
				State: "NOT_DEPLOYED",
				Message: error.Message
			};
		} else if (error.JsonData && error.JsonData.error_code) {
			var err = error.JsonData;
			if (err.error_code === "CF-InvalidAuthToken" || err.error_code === "CF-NotAuthenticated"){
				error.Retry = {
					parameters: [{id: "user", type: "text", name: "ID:"}, {id: "password", type: "password", name: "Password:"}]
				};
				
				error.forceShowMessage = true;
				error.Severity = "Info";
				error.Message = mCfUtil.getLoginMessage(cloudManageUrl);				
			
			} else if (err.error_code === "CF-TargetNotSet"){
				var cloudSettingsPageUrl = new URITemplate("{+OrionHome}/settings/settings.html#,category=cloud").expand({OrionHome : PageLinks.getOrionHome()});
				error.Message = "Set up your Cloud. Go to [Settings](" + cloudSettingsPageUrl + ")."; 
			}
		}
		
		window.parent.postMessage(JSON.stringify({pageService: "orion.page.delegatedUI", 
			 source: "org.eclipse.orion.client.cf.deploy.uritemplate", 
			 status: error}), "*");
	}

});