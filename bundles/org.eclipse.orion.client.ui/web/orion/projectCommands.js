/*******************************************************************************
 * @license
 * Copyright (c) 2013, 2014 IBM Corporation and others.
 * All rights reserved. This program and the accompanying materials are made 
 * available under the terms of the Eclipse Public License v1.0 
 * (http://www.eclipse.org/legal/epl-v10.html), and the Eclipse Distribution 
 * License v1.0 (http://www.eclipse.org/org/documents/edl-v10.html). 
 *
 * Contributors:
 *     IBM Corporation - initial API and implementation
 *******************************************************************************/
/*global window define orion XMLHttpRequest confirm*/
/*jslint sub:true*/
define(['i18n!orion/navigate/nls/messages', 'orion/webui/littlelib', 'orion/commands', 'orion/Deferred', 'orion/webui/dialogs/DirectoryPrompterDialog',
 'orion/commandRegistry', 'orion/i18nUtil', 'orion/webui/dialogs/ImportDialog', 'orion/widgets/projects/ProjectOptionalParametersDialog', 'orion/editorCommands', 'orion/EventTarget',
 'orion/URITemplate', 'orion/PageLinks', 'orion/objects'],
	function(messages, lib, mCommands, Deferred, DirectoryPrompterDialog, mCommandRegistry, i18nUtil, ImportDialog, ProjectOptionalParametersDialog, mEditorCommands, EventTarget,
		URITemplate, PageLinks, objects){
		var projectCommandUtils = {};
		
		var selectionListenerAdded = false;
		
		var lastItemLoaded = {Location: null};
		
		var progress;
		
			
	function forceSingleItem(item) {
		if (!item) {
			return {};
		}
		if (Array.isArray(item)) {
			if (item.length === 1) {
				item = item[0];
			} else {
				item = {};
			}
		}
		return item;
	}
	
	function getCommandParameters(mainParams, optionalParams){
		if(!mainParams){
			return null;
		}
		var paramDescps = [];
		for(var i=0; i<mainParams.length; i++){
			paramDescps.push(new mCommandRegistry.CommandParameter(mainParams[i].id, mainParams[i].type, mainParams[i].name));
		}
		return new mCommandRegistry.ParametersDescription(paramDescps, {hasOptionalParameters: !!optionalParams, optionalParams: optionalParams});
	}
	
	function handleParamsInCommand(func, data, dialogTitle){
		if(data.parameters && data.parameters.optionsRequested){
			var dialog = new ProjectOptionalParametersDialog.ProjectOptionalParametersDialog({title: dialogTitle, data: data, func: function(){
				data.parameters.optionsRequested = false;
				func(data);
			}.bind(this)});
			dialog.show();
			return;
		}
		
		var params = data.oldParams || {};
		if(data.parameters){
			for (var param in data.parameters.parameterTable) {
				params[param] = data.parameters.valueFor(param);
			}
		}
		if(data.parameters && data.parameters._options.optionalParams)
		for(var i=0; i<data.parameters._options.optionalParams.length; i++){
			var param = data.parameters._options.optionalParams[i];
			params[param.id] = param.value;
		}
		return params;
	}
	
	
	var sharedLaunchConfigurationDispatcher;
	
	projectCommandUtils.getLaunchConfigurationDispatcher = function(){
		if(!sharedLaunchConfigurationDispatcher){
			sharedLaunchConfigurationDispatcher = new EventTarget();
		}
		return sharedLaunchConfigurationDispatcher;
	};

	
	function localHandleStatus(status, allowHTML, context) {
		if (!allowHTML && status && typeof status.HTML !== "undefined") { //$NON-NLS-0$
			delete status.HTML;
		}
		progress.setProgressResult(status);
		
		if(status.ToSave){
			progress.showWhile(context.projectClient.saveProjectLaunchConfiguration(context.project, status.ToSave.ConfigurationName, context.deployService.id, status.ToSave.Parameters, status.ToSave.Url, status.ToSave.ManageUrl, status.ToSave.Path), "Saving configuration").then(
				function(configuration){
					if(sharedLaunchConfigurationDispatcher){
						sharedLaunchConfigurationDispatcher.dispatchEvent({type: "create", newValue: configuration });
					}
				}, context.errorHandler
			);
		}
	};
	
	/**
	 * @param params
	 * 			Params passed to deploy service
	 * @param context.project
	 * @param context.deployService
	 * @param context.data
	 * @param context.errorHandler
	 * @param context.projectClient
	 * @param context.commandService
	 */
	function runDeploy(params, context){
		if(sharedLaunchConfigurationDispatcher && context.launchConfiguration){
			context.launchConfiguration.status = {State: "PROGRESS"};
			sharedLaunchConfigurationDispatcher.dispatchEvent({type: "changeState", newValue: context.launchConfiguration });
		}
		
		progress.showWhile(context.deployService.deploy(context.project, params), context.deployService.name + " in progress", true).then(function(result){
			if(!result){
				return;
			}
			
			if (result.UriTemplate) {
			    var options = {};
				options.uriTemplate = result.UriTemplate;
				options.width = result.Width;
				options.height = result.Height;
				options.id = context.deployService.id; 
				options.done = localHandleStatus;
				options.status = localHandleStatus;
				mEditorCommands.createDelegatedUI(options);
			}

			if(context.launchConfiguration && (result.State || result.CheckState)){
				context.launchConfiguration.status = result;
				if(sharedLaunchConfigurationDispatcher){
					sharedLaunchConfigurationDispatcher.dispatchEvent({type: "changeState", newValue: context.launchConfiguration});
				}
			}
			
			if(result.ToSave){
				progress.showWhile(context.projectClient.saveProjectLaunchConfiguration(context.project, result.ToSave.ConfigurationName, context.deployService.id, result.ToSave.Parameters, result.ToSave.Url, result.ToSave.ManageUrl, result.ToSave.Path), "Saving configuration").then(
					function(configuration){
						if(sharedLaunchConfigurationDispatcher){
							sharedLaunchConfigurationDispatcher.dispatchEvent({type: "create", newValue: configuration});
						}
					}, context.errorHandler
				);
			}
			
		}, function(error){
			if(error.Retry && error.Retry.parameters){
				context.data.parameters = getCommandParameters(error.Retry.parameters, error.Retry.optionalParameters);
				context.data.oldParams = params;
				context.commandService.collectParameters(context.data);
			} else {
				context.errorHandler(error);
			}
		});
	};
	
	var sharedDependencyDispatcher;
	
	projectCommandUtils.getDependencyDispatcher = function(){
		if(!sharedDependencyDispatcher){
			sharedDependencyDispatcher = new EventTarget();
		}
		return sharedDependencyDispatcher;
	};
			
	function initDependency(projectClient, explorer, commandService, errorHandler, handler, dependency, project, data, params){
			var actionComment;
			if(handler.actionComment){
				if(params){
					actionComment = handler.actionComment.replace(/\$\{([^\}]+)\}/g, function(str, key) {
						return params[key];
					});
				} else {
					actionComment = handler.actionComment;
				}
			} else {
				actionComment = "Getting content from "	+ handler.type;
			}
			progress.showWhile(handler.initDependency(dependency, params, project), actionComment).then(function(dependency){
				projectClient.addProjectDependency(project, dependency).then(function(){
						if(sharedDependencyDispatcher){
							sharedDependencyDispatcher.dispatchEvent({type: "create", newValue: dependency, project: project });
						}
					}, errorHandler);
			}, function(error){
				if(error.Retry && error.Retry.addParameters){
					data.parameters = getCommandParameters(error.Retry.addParameters, error.Retry.optionalParameters);
					data.oldParams = params;
					commandService.collectParameters(data);
				}
				errorHandler(error);
			});
	}
	
	projectCommandUtils.updateProjectNavCommands = function(treeRoot, launchConfigurations, commandService, projectClient, fileClient){
		
		function errorHandler(error) {
			if (progress) {
				progress.setProgressResult(error);
			} else {
				window.console.log(error);
			}
		}
		
		for(var i=0; i<launchConfigurations.length; i++){
			var launchConfiguration = launchConfigurations[i];
			var deployLaunchConfigurationCommands = new mCommands.Command({
				name: launchConfiguration.Name,
				tooltip: launchConfiguration.Name,
				id: "orion.launchConfiguration.deploy." + launchConfiguration.ServiceId + launchConfiguration.Name,
				imageClass: "core-sprite-deploy",
				callback: function(data) {
					var item = forceSingleItem(data.items);
					
					data.oldParams = launchConfiguration;
	
					var func = arguments.callee;
					var params = handleParamsInCommand(func, data, "Deploy " + item.Name);
					if(!params){
						return;
					}
					
					projectClient.getProjectDelpoyService(launchConfiguration.ServiceId).then(function(service){
						if(service && service.deploy){
							fileClient.loadWorkspace(item.Project.ContentLocation).then(function(projectFolder){
								runDeploy(params, {project: treeRoot.Project, deployService: service, data: data, errorHandler: errorHandler, projectClient: projectClient, commandService: commandService, launchConfiguration: launchConfiguration});
							});
						}
					});
				},
				visibleWhen: function(items) {
					var item = forceSingleItem(items);
					return(item.Project === treeRoot.Project);
				}
			});
			commandService.addCommand(deployLaunchConfigurationCommands);
		}
	},
	projectCommandUtils.createDependencyCommands = function(serviceRegistry, commandService, explorer, fileClient, projectClient, dependencyTypes) {
		progress = serviceRegistry.getService("orion.page.progress"); //$NON-NLS-0$
		
		function errorHandler(error) {
			if (progress) {
				progress.setProgressResult(error);
			} else {
				window.console.log(error);
			}
		}
		
		var connectDependencyCommand = new mCommands.Command({
			name: "Connect",
			tooltip: "Fetch content",
			id: "orion.project.dependency.connect", //$NON-NLS-0$
			callback: function(data) {
				var item = forceSingleItem(data.items);
				
				var func = arguments.callee;
				var params = handleParamsInCommand(func, data, "Fetch content of " + item.Dependency.Name);
				if(!params){
					return;
				}
				var projectHandler = projectClient.getProjectHandler(item.Dependency.Type);
				if(projectHandler.then){
					projectHandler.then(function(projectHandler){
						initDependency(projectClient, explorer, commandService, errorHandler,projectHandler, item.Dependency, item.Project, data, params);
					});
				} else {
					initDependency(projectClient, explorer, commandService, errorHandler,projectHandler, item.Dependency, item.Project, data, params);
				}
				
			},
			visibleWhen: function(item) {
				if(!(item.Dependency && item.Project && item.disconnected)){
					return false;	
				}
				if (dependencyTypes) {
					for(var i=0; i<dependencyTypes.length; i++){
						if(dependencyTypes[i]===item.Dependency.Type){
							return true;	
						}
					}
				}
				return false;
			}
		});
		commandService.addCommand(connectDependencyCommand);
		
				
		var disconnectDependencyCommand = new mCommands.Command({
			name: "Disconnect from project",
			tooltip: "Do not treat this folder as a part of the project",
			imageClass: "core-sprite-delete", //$NON-NLS-0$
			id: "orion.project.dependency.disconnect", //$NON-NLS-0$
			callback: function(data) {
				var item = forceSingleItem(data.items);
				progress.progress(projectClient.removeProjectDependency(item.Project, item.Dependency),
					i18nUtil.formatMessage("Removing ${0} from project ${1}", item.Dependency.Name, item.Project.Name)).then(function(resp){
						if(sharedDependencyDispatcher){
							sharedDependencyDispatcher.dispatchEvent({type: "delete", oldValue: item.Dependency, project: item.Project });
						}
					});
			},
			visibleWhen: function(item) {
				if(!(item.Dependency && item.Project)){
					return false;	
				}
				return true;
			}
		});
		commandService.addCommand(disconnectDependencyCommand);
		
		var checkStateCommand = new mCommands.Command({
			name: "Check status",
			tooltip: "Check application status",
			id: "orion.launchConfiguration.checkStatus", //$NON-NLS-0$
			callback: function(data) {
				var item = forceSingleItem(data.items);
				
				if(!data.parameters){
					data.parameters = getCommandParameters(item.parametersRequested, item.optionalParameters);
					data.oldParams = item.Params;
					commandService.collectParameters(data);
					return;
				}

				var func = arguments.callee;
				var params = handleParamsInCommand(func, data, "Check application state");
				if(!params){
					return;
				}
				
				projectClient.getProjectDelpoyService(item.ServiceId).then(function(service){
					if(sharedLaunchConfigurationDispatcher){
						item.status = {State: "PROGRESS"};
						sharedLaunchConfigurationDispatcher.dispatchEvent({type: "changeState", newValue: item });
					}
					if(service && service.getState){
						service.getState(params).then(function(result){
							item.status = result;
							if(sharedLaunchConfigurationDispatcher){
								sharedLaunchConfigurationDispatcher.dispatchEvent({type: "changeState", newValue: item });
							}
							//try to refresh other launchConfigurations from this service,
							//because maybe adding properties to one changed the status of others
							if(item.project && item.project.children){
								item.project.children.forEach(function(otherLaunch){
									if(item.ServiceId && item.Name && item.parametersRequested){
										if(otherLaunch.ServiceId === item.ServiceId && otherLaunch.Name !== item.Name){
											if(sharedLaunchConfigurationDispatcher){
												otherLaunch.status = {CheckState: true};
												sharedLaunchConfigurationDispatcher.dispatchEvent({type: "changeState", newValue: otherLaunch });
											}
										}
									}
								});
							}
							
						}, function(error){
							if(error.Retry){
								data.parameters = getCommandParameters(error.Retry.parameters, error.Retry.optionalParameters);
								data.oldParams = params;
								commandService.collectParameters(data);
							} else {
								errorHandler(error);
								item.status = {error: error};
								if(sharedLaunchConfigurationDispatcher){
									sharedLaunchConfigurationDispatcher.dispatchEvent({type: "changeState", newValue: item });
								}
							}
						});
					}
				});


			},
			visibleWhen: function(items) {
				var item = forceSingleItem(items);
				return item.ServiceId && item.Name && item.parametersRequested;
			}
		});
		commandService.addCommand(checkStateCommand);
		
		function createStartStopCommand(start){
			var stopApplicationCommand = new mCommands.Command({
				name: start ? "Start" :"Stop",
				tooltip: start ? "Start application" : "Stop application",
				id: start ? "orion.launchConfiguration.startApp" : "orion.launchConfiguration.stopApp", //$NON-NLS-0$
				imageClass: start ? "core-sprite-start" : "core-sprite-stop",
				callback: function(data) {
					var item = forceSingleItem(data.items);
					
					data.oldParams = item.Params;
	
					var func = arguments.callee;
					var params = handleParamsInCommand(func, data, start? "Start application" : "Stop application");
					if(!params){
						return;
					}
					
					projectClient.getProjectDelpoyService(item.ServiceId).then(function(service){
						if(service && (start ? service.start : service.stop)){
							if(sharedLaunchConfigurationDispatcher){
								item.status = {State: "PROGRESS"};
								sharedLaunchConfigurationDispatcher.dispatchEvent({type: "changeState", newValue: item });
							}
							(start ? service.start : service.stop)(params).then(function(result){
								item.status = result;
								if(sharedLaunchConfigurationDispatcher){
									sharedLaunchConfigurationDispatcher.dispatchEvent({type: "changeState", newValue: item });
								}
								if(result.ToSave){
									progress.showWhile(projectClient.saveProjectLaunchConfiguration(item.project, result.ToSave.ConfigurationName, service.id, result.ToSave.Parameters, result.ToSave.Url, result.ToSave.ManageUrl, result.ToSave.Path), "Saving configuration").then(
										function(configuration){
											if(sharedLaunchConfigurationDispatcher){
												sharedLaunchConfigurationDispatcher.dispatchEvent({type: "create", newValue: configuration });
											}
										}, errorHandler
									);
								}
							}, function(error){
								if(error.Retry){
									data.parameters = getCommandParameters(error.Retry.parameters, error.Retry.optionalParameters);
									data.oldParams = params;
									commandService.collectParameters(data);
								} else {
									errorHandler(error);
								}
							});
						}
					});
				},
				visibleWhen: function(items) {
					var item = forceSingleItem(items);
					return item.ServiceId && item.Name && item.status && (start ? item.status.State==="STOPPED" : item.status.State==="STARTED");
				}
			});
			commandService.addCommand(stopApplicationCommand);
		}
		
		createStartStopCommand(true);
		createStartStopCommand(false);
		
		var manageLaunchConfigurationCommand = new mCommands.Command({
			name: "Manage",
			tooltip: "Manage this application on remote server",
			id: "orion.launchConfiguration.manage",
			hrefCallback: function(data) {
				var item = forceSingleItem(data.items);
				if(item.ManageUrl){
					var uriTemplate = new URITemplate(item.ManageUrl);
					var params = objects.clone(item.Params);
					params.OrionHome = PageLinks.getOrionHome();
					var uri = uriTemplate.expand(params);
					if(!uri.indexOf("://")){
						uri = "http://" + uri;
					}
					return uri;
				}
			},
			visibleWhen: function(items) {
				var item = forceSingleItem(items);
				return item.ManageUrl;
			}
		});
		commandService.addCommand(manageLaunchConfigurationCommand);
		
		var deployLaunchConfigurationCommands = new mCommands.Command({
			name: "Deploy",
			tooltip: "Deploy this application again",
			id: "orion.launchConfiguration.deploy",
			imageClass: "core-sprite-deploy",
			callback: function(data) {
				var item = forceSingleItem(data.items);
				
				data.oldParams = item;

				var func = arguments.callee;
				var params = handleParamsInCommand(func, data, "Deploy " + item.Name);
				if(!params){
					return;
				}
				
				projectClient.getProjectDelpoyService(item.ServiceId).then(function(service){
					if(service && service.deploy){
						fileClient.loadWorkspace(item.project.ContentLocation).then(function(projectFolder){
							runDeploy(params, {project: item.project, deployService: service, data: data, errorHandler: errorHandler, projectClient: projectClient, commandService: commandService, launchConfiguration: item});
						});
					}
				});
			},
			visibleWhen: function(items) {
				var item = forceSingleItem(items);
				return item.ServiceId && item.Name;
			}
		});
		commandService.addCommand(deployLaunchConfigurationCommands);
	};
		
	/**
	 * Creates the commands related to file management.
	 * @param {orion.serviceregistry.ServiceRegistry} serviceRegistry The service registry to use when creating commands
	 * @param {orion.commandregistry.CommandRegistry} commandRegistry The command registry to get commands from
	 * @param {orion.explorer.FileExplorer} explorer The explorer view to add commands to, and to update when model items change.
	 * To broadcast model change nodifications, this explorer must have a <code>modelEventDispatcher</code> field.
	 * @param {orion.EventTarget} [explorer.modelEventDispatcher] If supplied, this dispatcher will be invoked to dispatch events
	 * describing model changes that are performed by file commands.
	 * @param {orion.fileClient.FileClient} fileClient The file system client that the commands should use
	 * @name orion.fileCommands#createFileCommands
	 * @function
	 */
	projectCommandUtils.createProjectCommands = function(serviceRegistry, commandService, explorer, fileClient, projectClient, dependencyTypes, deploymentTypes) {
		progress = serviceRegistry.getService("orion.page.progress"); //$NON-NLS-0$
		var that = this;
		function errorHandler(error) {
			if (progress) {
				progress.setProgressResult(error);
			} else {
				window.console.log(error);
			}
		}
		
				
		function dispatchNewProject(workspace, project){
			var dispatcher = explorer.modelEventDispatcher;
			if (dispatcher && typeof dispatcher.dispatchEvent === "function") { //$NON-NLS-0$
				if(project.ContentLocation){
					fileClient.read(project.ContentLocation, true).then(function(folder){
						dispatcher.dispatchEvent( { type: "create", parent: workspace, newValue: folder});
					},
					function(){
						dispatcher.dispatchEvent( { type: "create", parent: workspace, newValue: null});					
					});
				} else {
					dispatcher.dispatchEvent( { type: "create", parent: workspace, newValue: null});
				}
			} else {
				explorer.changedItem(workspace, true);
			}
		}
		
		dependencyTypes =  dependencyTypes || [];
		
		var addFolderCommand = new mCommands.Command({
			name: "Associated Folder",
			tooltip: "Add an associated folder from workspace",
			id: "orion.project.addFolder", //$NON-NLS-0$
			callback: function(data) {
				var item = forceSingleItem(data.items).Project;
				
				var dialog = new DirectoryPrompterDialog.DirectoryPrompterDialog({ title : messages["Choose a Folder"],
					serviceRegistry : serviceRegistry,
					fileClient : fileClient,
					func : function(targetFolder) {
						fileClient.read(targetFolder.Location, true).then(function(fileMetadata){
						
							function addFileDependency(){
								var fileLocation = "";
								var name = fileMetadata.Name;
								if(fileMetadata.Parents && fileMetadata.Parents.length>0){
									for(var i=fileMetadata.Parents.length-1; i>=0; i--){
										fileLocation+=fileMetadata.Parents[i].Name;
										fileLocation+= "/";
									}
									name += " (" + fileMetadata.Parents[fileMetadata.Parents.length-1].Name + ")";
								}
								fileLocation+=fileMetadata.Name;
								var dependency = {Name: name, Type: "file", Location: fileLocation};
								projectClient.addProjectDependency(item, {Name: name, Type: "file", Location: fileLocation}).then(function(){
									if(sharedDependencyDispatcher){
										sharedDependencyDispatcher.dispatchEvent({type: "create", newValue: dependency , project: item});
									}
								}, errorHandler);
							}
						
							if(!fileMetadata.Parents || fileMetadata.Parents.length===0){
								var otherTypesDefs = [];
								var isOtherDependency = false;
								for(var i=0; i<dependencyTypes.length; i++){
									if(isOtherDependency) {
										return;
									}
									var def = projectClient.getProjectHandler(dependencyTypes[i]).then(function(projectHandler){
										return projectHandler.getDependencyDescription(fileMetadata);
									});
									otherTypesDefs.push(def);
									def.then(function(dependency){
										if(dependency){
											isOtherDependency = true;
											projectClient.addProjectDependency(item, dependency).then(function(){
												if(sharedDependencyDispatcher){
													sharedDependencyDispatcher.dispatchEvent({type: "create", newValue: dependency, project: item});
												}
											}, errorHandler);
										}
									});
								}
								Deferred.all(otherTypesDefs).then(function(){
									if(!isOtherDependency){
										addFileDependency();
									}
								});
								return;
							}
							addFileDependency();
						}, errorHandler);
					}
				});
				
				dialog.show();
				
			},
			visibleWhen: function(item) {
				if (!explorer.isCommandsVisible()) {
					return false;
				}
				return item.type==="Project" || explorer.treeRoot.type==="Project";
			}
		});
		commandService.addCommand(addFolderCommand);
		
		var initProjectCommand = new mCommands.Command({
			name: "Convert to project",
			tooltip: "Convert this folder into a project",
			id: "orion.project.initProject", //$NON-NLS-0$
			visibleWhen: function(item) {
				if (!explorer.isCommandsVisible()) {
					return false;
				}
				return true;
			},
			callback: function(data) {
				var item = forceSingleItem(data.items);
				if(item){
					var init = function() {
						projectClient.initProject(item.Location).then(function(project){
							fileClient.read(item.Location, true).then(function(fileMetadata){
								explorer.changedItem(item, true);
							}, errorHandler);
							dispatchNewProject(item, project);
						}, errorHandler);
					};
					projectClient.readProject(item).then(function(project) {
						if (project) {
							progress.setProgressResult({
								Message: "This folder is a project already.",
								Severity: "Warning" //$NON-NLS-0$
							});
							explorer.changedItem(item, true);
						} else {
							init();
						}
					}, init);
				}
				
			},
			visibleWhen: function(items) {
				var item = forceSingleItem(items);
				if (item && ((item.parent && item.parent.Projects) || (item.Parents && item.Parents.length === 0))) {
					//TODO only works if children has been cached
					if (item.children) {
						for(var i=0; i<item.children.length; i++){
							if(item.children[i].Name && !item.children[i].Directory && item.children[i].Name.toLowerCase() === "project.json"){ //$NON-NLS-0$
								return false;
							}
						}
					}
					return true;
				}
				return false;
			}
		});
		commandService.addCommand(initProjectCommand);
		
		function createAddDependencyCommand(type){
			return projectClient.getProjectHandler(type).then(function(handler){
				if(!handler.initDependency){
					return;
				}
				
				var commandParams = {
					name: handler.addDependencyName,
					id: "orion.project.adddependency." + type,
					tooltip: handler.addDependencyTooltip,
					callback: function(data){
						var def = new Deferred();
						var item = forceSingleItem(data.items).Project;
						
						var func = arguments.callee;
						var params = handleParamsInCommand(func, data, handler.addDependencyTooltip);
						if(!params){
							return;
						}
						
						var searchLocallyDeferred = new Deferred();
						handler.paramsToDependencyDescription(params).then(function(dependency){
							if(dependency && dependency.Location){
								fileClient.loadWorkspace(item.WorkspaceLocation).then(function(workspace){
									var checkdefs = [];
									var found = false;
									for(var i=0; i<workspace.Children.length; i++){
										if(found===true){
											break;
										}
										var def = handler.getDependencyDescription(workspace.Children[i]);
										checkdefs.push(def);
										(function(i, def){
											def.then(function(matches){
												if(matches && matches.Location === dependency.Location){
													found = true;
													searchLocallyDeferred.resolve(matches);
												}
											});
										})(i, def);
									}
									Deferred.all(checkdefs).then(function(){
										if(!found){
											searchLocallyDeferred.resolve();
										}
									});
								}, searchLocallyDeferred.reject);
							} else {
								searchLocallyDeferred.resolve();
							}
						}, errorHandler);
						
						progress.showWhile(searchLocallyDeferred, "Searching your workspace for matching content").then(function(resp){
							if(resp) {
								projectClient.addProjectDependency(item, resp).then(function(){
									if(sharedDependencyDispatcher){
										sharedDependencyDispatcher.dispatchEvent({type: "create", newValue: resp, project: item });
									}
								}, errorHandler);
							} else {
								initDependency(projectClient, explorer, commandService, errorHandler,handler, {}, item, data, params);
							}
						});
	
					},
					visibleWhen: function(item) {
						if (!explorer.isCommandsVisible()) {
							return false;
						}
						return item.type==="Project" || explorer.treeRoot.type==="Project";
					}
				};
				
				commandParams.parameters = getCommandParameters(handler.addParameters, handler.optionalParameters);				
				
				var command = new mCommands.Command(commandParams);
				commandService.addCommand(command);
			});
		}
		
				
		function createInitProjectCommand(type){
			return projectClient.getProjectHandler(type).then(function(handler){
				if(!handler.initProject){
					return;
				}
				
				var commandParams = {
					name: handler.addProjectName,
					id: "orion.project.createproject." + type,
					tooltip: handler.addProjectTooltip,
					callback: function(data){
						var func = arguments.callee;
						var item = forceSingleItem(data.items);
						
						var params = handleParamsInCommand(func, data, handler.addProjectTooltip);
						if(!params){
							return;
						}
	
						var actionComment;
						if(handler.actionComment){
							if(params){
								actionComment = handler.actionComment.replace(/\$\{([^\}]+)\}/g, function(str, key) {
									return params[key];
								});
							} else {
								actionComment = handler.actionComment;
							}
						} else {
							actionComment = "Getting content from "	+ handler.type;
						}
						progress.showWhile(handler.initProject(params, {WorkspaceLocation: item.Location}), actionComment).then(function(project){
							dispatchNewProject(item, project);
						}, function(error){
							if(error.Retry && error.Retry.addParameters){
								data.parameters = getCommandParameters(error.Retry.addParameters, error.Retry.optionalParameters);
								data.oldParams = params;
								commandService.collectParameters(data);
							}
							errorHandler(error);
						});
	
					},
					visibleWhen: function(item) {
						if (!explorer.isCommandsVisible()) {
							return false;
						}
						item = forceSingleItem(item);
						return item.Location;
					}
				};
				
				commandParams.parameters = getCommandParameters(handler.addParameters, handler.optionalParameters);

				var command = new mCommands.Command(commandParams);
				commandService.addCommand(command);
			});
		}
		
		var allContributedCommandsDeferreds = [];
		
			for(var type_no=0; type_no<dependencyTypes.length; type_no++){
				var dependencyType = dependencyTypes[type_no];
				allContributedCommandsDeferreds.push(createAddDependencyCommand(dependencyType));
				allContributedCommandsDeferreds.push(createInitProjectCommand(dependencyType));
			}
		
		var addReadmeCommand = new mCommands.Command({
			name: "Readme File",
			tooltip: "Create README.md file in this project",
			id: "orion.project.create.readme",
			callback: function(data){
				var item = forceSingleItem(data.items);
				progress.progress(fileClient.createFile(item.Project.ContentLocation, "README.md"), "Creating README.md").then(function(readmeMeta){
					if(item.Project){
						progress.progress(fileClient.write(readmeMeta.Location, "# " + item.Project.Name), "Writing sample readme").then(function(){
							explorer.changedItem();							
						});
					} else {
						explorer.changedItem();
					}
				});
			},
			visibleWhen: function(item) {
				if (!explorer.isCommandsVisible()) {
					return false;
				}
				if(!item.Project || !item.Project.children || !item.Project.ContentLocation){
					return false;
				}
				for(var i=0; i<item.Project.children.length; i++){
					if(item.Project.children[i].Name && item.Project.children[i].Name.toLowerCase() === "readme.md"){
						return false;
					}
				}
				return true;
			}
		});
		
		commandService.addCommand(addReadmeCommand);
		
		var createBasicProjectCommand = new mCommands.Command({
			name: "Basic Project",
			tooltip: "Create an empty project",
			id: "orion.project.create.basic",
			parameters : new mCommandRegistry.ParametersDescription([new mCommandRegistry.CommandParameter("name", "text", "Name: ")]),
			callback: function(data){
					var name = data.parameters.valueFor("name");
					if(!name){
						return;
					}
					var item = forceSingleItem(data.items);
					fileClient.loadWorkspace(fileClient.fileServiceRootURL(item.Location)).then(function(workspace) {
						progress.progress(projectClient.createProject(workspace.ChildrenLocation, {Name: name}), "Creating project " + name).then(function(project){
							dispatchNewProject(workspace, project);
						});
					});
				},
			visibleWhen: function(item) {
					if (!explorer.isCommandsVisible()) {
						return false;
					}
					item = forceSingleItem(item);
					return(!!item.Location);
				}
			}
			);
			
			commandService.addCommand(createBasicProjectCommand);
			
			var createSftpProjectCommand = new mCommands.Command({
				name: "Project from an SFTP Site",
				tooltip: "Create a project from an SFTP site",
				id: "orion.project.create.sftp",
				parameters : new mCommandRegistry.ParametersDescription([new mCommandRegistry.CommandParameter('name', 'text', 'Name:'),  //$NON-NLS-2$ //$NON-NLS-1$ //$NON-NLS-0$
		                                                               		new mCommandRegistry.CommandParameter('url', 'url', 'Url:')]), //$NON-NLS-2$ //$NON-NLS-1$ //$NON-NLS-0$
				callback: function(data){
						var name = data.parameters.valueFor("name");
						if(!name){
							return;
						}
						var url = data.parameters.valueFor("url");
						if(!url){
							return;
						}
						var item = forceSingleItem(data.items);
						fileClient.loadWorkspace(fileClient.fileServiceRootURL(item.Location)).then(function(workspace) {
							progress.progress(projectClient.createProject(workspace.ChildrenLocation, {Name: name, ContentLocation: url}), "Creating project " + name).then(function(project){
								dispatchNewProject(workspace, project);
							});
						});
					},
				visibleWhen: function(item) {
						if (!explorer.isCommandsVisible()) {
							return false;
						}
						item = forceSingleItem(item);
						return(!!item.Location);
					}
				}
				);
				
				commandService.addCommand(createSftpProjectCommand);
				
			var createZipProjectCommand = new mCommands.Command({
			name: "Project from a Zipped Folder",
			tooltip: "Create project and fill it with data from local file",
			id: "orion.project.create.fromfile",
			parameters : new mCommandRegistry.ParametersDescription([new mCommandRegistry.CommandParameter("name", "text", "Name: ")]),
			callback: function(data){
					var name = data.parameters.valueFor("name");
					if(!name){
						return;
					}
					var item = forceSingleItem(data.items);
					
					fileClient.loadWorkspace(fileClient.fileServiceRootURL(item.Location)).then(function(workspace) {
						progress.progress(projectClient.createProject(workspace.ChildrenLocation, {Name: name}), "Creating project " + name).then(function(projectInfo){
							progress.progress(fileClient.read(projectInfo.ContentLocation, true)).then(function(projectMetadata){
								var dialog = new ImportDialog.ImportDialog({
									importLocation: projectMetadata.ImportLocation,
									func: function() {
										dispatchNewProject(workspace, projectInfo);
									}
								});
								dialog.show();
							});
						});
					});
				},
			visibleWhen: function(item) {
					if (!explorer.isCommandsVisible()) {
						return false;
					}
					item = forceSingleItem(item);
					return(!!item.Location);
				}
			}
			);
			
			commandService.addCommand(createZipProjectCommand);
			
			projectCommandUtils.createDependencyCommands(serviceRegistry, commandService, explorer, fileClient, projectClient, dependencyTypes);
			
			function createDeployProjectCommand(deployService){
				var commandParams = {
					name: deployService.name,
					tootlip: deployService.tooltip,
					id: "orion.project.deploy." + deployService.id,
					callback: function(data){
						var item = forceSingleItem(data.items);
						var project = item.Project;
						
						var appPath = item.Location.replace(project.ContentLocation, "");
						
						var func = arguments.callee;
						var params = handleParamsInCommand(func, data, deployService.tooltip);
						if(!params){
							return;
						}
						
						params.Path = appPath;
						
						runDeploy(params, {
							project: project,
							deployService: deployService,
							data: data,
							errorHandler: errorHandler,
							projectClient: projectClient,
							commandService: commandService
						});

					},
					visibleWhen: function(item) {
						if(!item.Project || !item.children || item.children.length === 0){
							return false;
						}
						return projectClient.matchesDeployService(item.children[0], deployService);
					}
				};
				
				commandParams.parameters = getCommandParameters(deployService.parameters, deployService.optionalParameters);
				
				var command = new mCommands.Command(commandParams);
				commandService.addCommand(command);
			}
			
			if(deploymentTypes){
				for(var i=0; i<deploymentTypes.length; i++){
					var type = deploymentTypes[i];
					var deferred = new Deferred();
					allContributedCommandsDeferreds.push(deferred);
					(function(deferred){
						projectClient.getProjectDelpoyService(type).then(function(deployService){
							createDeployProjectCommand(deployService);
							deferred.resolve();
						});
					})(deferred);
				}
			}
			
			
			return Deferred.all(allContributedCommandsDeferreds);
		};
	
		return projectCommandUtils;
});
