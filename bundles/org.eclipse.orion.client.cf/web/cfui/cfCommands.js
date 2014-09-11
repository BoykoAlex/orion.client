/*******************************************************************************
 * @license
 * Licensed Materials - Property of IBM
 * (c) Copyright IBM Corporation 2014. All Rights Reserved. 
 * 
 * Note to U.S. Government Users Restricted Rights:  Use, 
 * duplication or disclosure restricted by GSA ADP Schedule 
 * Contract with IBM Corp.
 *******************************************************************************/
 /*global define*/
 /*eshint-env browser, amd*/
define(['orion/Deferred', 'orion/commands', 'orion/commandRegistry', 'orion/EventTarget', 'orion/cfui/widgets/SelectAppDialog'],
	function(Deferred, mCommands, mCommandRegistry, EventTarget, mSelectAppDialog){
	
	var sharedEventDispatcher;
	
	return {
		
		getEventDispatcher: function(){
			if(!sharedEventDispatcher){
				sharedEventDispatcher = new EventTarget();
			}
			return sharedEventDispatcher;
		},
		
		createCfCommands: function(serviceRegistry, commandService, explorer){
			
			var progressService = serviceRegistry.getService("orion.page.progress");
			var cfClient = serviceRegistry.getService("orion.cf.service");
		},
		
		createRoutesCommands: function(serviceRegistry, commandService, explorer, refreshFunc){
			
			var progressService = serviceRegistry.getService("orion.page.progress");
			var cfClient = serviceRegistry.getService("orion.cf.service");
			
			var createRouteParameters = new mCommandRegistry.ParametersDescription(
					[new mCommandRegistry.CommandParameter("domain", "text", 'Domain:'),
					 new mCommandRegistry.CommandParameter("host", "text", 'Host:')]);
			
			var createRouteCommand = new mCommands.Command({
				name : "Create",
				tooltip: "Create route",
				id : "orion.cf.CreateRoute",
				parameters: createRouteParameters,
				
				callback : function(data) {
					var target = data.items;
					
					var domain = data.parameters.valueFor("domain");
					var host = data.parameters.valueFor("host");
					
					progressService.showWhile(cfClient.createRoute(target, 
							domain, host), "Creating route...").then(
						function(jazzResp) {
							if(sharedEventDispatcher){
								sharedEventDispatcher.dispatchEvent({type: "create", newValue: jazzResp });
							}
						}, function (error) {
							exports.handleError(error, progressService);
						}
					);
				},
				visibleWhen : function(item) {
					return true;
				}
			});
			
			commandService.addCommand(createRouteCommand);
			
			var deleteOrphanedRoutesCommand = new mCommands.Command({
				name : "Delete All Unmapped",
				tooltip: "Delete all unmapped routes",
				id : "orion.cf.DeleteOrphanedRoutes",
				
				callback : function(data) {
					var target = data.items;
					
					progressService.showWhile(cfClient.deleteOrphanedRoutes(target), 
						"Deleteing all unmapped routes...").then(
						function(jazzResp) {
							refreshFunc();
						}, function (error) {
							exports.handleError(error, progressService);
						}
					);
				},
				visibleWhen : function(item) {
					return true;
				}
			});
			
			commandService.addCommand(deleteOrphanedRoutesCommand);
			
			var deleteRouteCommand = new mCommands.Command({
				name : "Delete",
				tooltip: "Delete route",
				id : "orion.cf.DeleteRoute",
				
				callback : function(data) {
					var route = data.items[0];
					var target = route.target;
					
					progressService.showWhile(cfClient.deleteRouteById(target, 
						route.Guid), "Deleting route...").then(
						function(jazzResp) {
							if(sharedEventDispatcher){
								sharedEventDispatcher.dispatchEvent({type: "delete", oldValue: route });
							}
						}, function (error) {
							exports.handleError(error, progressService);
						}
					);
				},
				visibleWhen : function(item) {
					if(!Array.isArray(item)){
						item = [item];
					}
					
					for (var i = 0; i < item.length; i++) {
					    if (!item[i].Type || item[i].Type !== "Route")
					    	return false;
					}
					
					return true;
				}
			});
			
			commandService.addCommand(deleteRouteCommand);
			
			var mapRouteCommand = new mCommands.Command({
				name : "Map to app",
				tooltip: "Add the route to an app",
				id : "orion.cf.MapRoute",
				
				callback : function(data) {
					var route = data.items[0];
					var target = route.target;
					
					progressService.showWhile(cfClient.getApps(target), "Loading...").then(
						function(result){
							var dialog = new mSelectAppDialog.SelectAppDialog({
								title: "Select Application",
								cfClient: cfClient,
								serviceRegistry: serviceRegistry,
								apps: result.Apps,
								func: function(app) {
									progressService.showWhile(cfClient.mapRoute(target, app.Guid, 
										route.Guid), "Mapping route to an app ...").then(
										function(resp) {
											if(sharedEventDispatcher){
												sharedEventDispatcher.dispatchEvent({type: "map", app: app, route: route, expand: true });
											} else {
												refreshFunc();
											}
										}, function (error) {
											exports.handleError(error, progressService);
										}
									);
								}
							});
							
							dialog.show();
						}
					);
				},
				visibleWhen : function(item) {
					if(!Array.isArray(item)){
						item = [item];
					}
					
					return item.length === 1 && item[0].Type === "Route";
				}
			});
			
			commandService.addCommand(mapRouteCommand);
			
			var unmapRouteCommand = new mCommands.Command({
				name : "Unmap from app",
				tooltip: "Remove the route from an app",
				id : "orion.cf.UnmapRoute",
				
				callback : function(data) {
					var route = data.items[0];
					var app = route.parent;
					var target = app.parent.Target;
					
					progressService.showWhile(cfClient.unmapRoute(target, app.Guid, 
						route.Guid), "Removing route from an app ...").then(
						function(resp) {
							if(sharedEventDispatcher){
								sharedEventDispatcher.dispatchEvent({type: "unmap", app: app, route: route, expand: true });
							} else {
								refreshFunc();
							}
						}, function (error) {
							exports.handleError(error, progressService);
						}
					);
				},
				visibleWhen : function(item) {
					if(!Array.isArray(item)){
						item = [item];
					}
					
					return item.length === 1 && item[0].Type === "Route";
				}
			});
			
			commandService.addCommand(unmapRouteCommand);
		},
		
		registerModelListener: function(listener){
			
		}
	};
});
