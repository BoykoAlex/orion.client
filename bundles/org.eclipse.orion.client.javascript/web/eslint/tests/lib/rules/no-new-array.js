/*******************************************************************************
 * @license
 * Copyright (c) 2014 IBM Corporation and others.
 * All rights reserved. This program and the accompanying materials are made 
 * available under the terms of the Eclipse Public License v1.0 
 * (http://www.eclipse.org/legal/epl-v10.html), and the Eclipse Distribution 
 * License v1.0 (http://www.eclipse.org/org/documents/edl-v10.html). 
 *
 * Contributors:
 *     IBM Corporation - initial API and implementation
 *******************************************************************************/
/*eslint-env amd, node, mocha*/
define([
"chai/chai", 
"eslint"
], function(assert, eslint) {
	assert = assert.assert /*chai*/ || assert;

	var RULE_ID = "no-new-array";

	describe(RULE_ID, function() {
		describe("should", function() {
			it("flag in global scope", function() {
				var topic = "new Array()";
	
				var config = { rules: {} };
				config.rules[RULE_ID] = 1;
	
				var messages = eslint.verify(topic, config);
				assert.equal(messages.length, 1);
				assert.equal(messages[0].ruleId, RULE_ID);
				assert.equal(messages[0].message, "Use the array literal notation '[]'.");
				assert.equal(messages[0].node.type, "Identifier");
			});
			it("flag when symbol is declared in /*global block", function() {
				var topic = "/*global Array*/ new Array();";
	
				var config = { rules: {} };
				config.rules[RULE_ID] = 1;
	
				var messages = eslint.verify(topic, config);
				assert.equal(messages.length, 1);
				assert.equal(messages[0].ruleId, RULE_ID);
				assert.equal(messages[0].message, "Use the array literal notation '[]'.");
				assert.equal(messages[0].node.type, "Identifier");
			});
			it("flag in inner scope", function() {
				var topic = "(function f() { var x = new Array(); }());";
	
				var config = { rules: {} };
				config.rules[RULE_ID] = 1;
	
				var messages = eslint.verify(topic, config);
				assert.equal(messages.length, 1);
				assert.equal(messages[0].ruleId, RULE_ID);
				assert.equal(messages[0].message, "Use the array literal notation '[]'.");
				assert.equal(messages[0].node.type, "Identifier");
			});
		});
	
		describe("shalt not", function() {
			it("flag when symbol refers to in-scope var - global", function() {
				var topic = "var Array; new Array();";
	
				var config = { rules: {} };
				config.rules[RULE_ID] = 1;
	
				var messages = eslint.verify(topic, config);
				assert.equal(messages.length, 0);
			});
	
			it("flag when symbol refers to in-scope var - non-global", function() {
				var topic = "var Array; function f() { new Array(); }";
	
				var config = { rules: {} };
				config.rules[RULE_ID] = 1;
	
				var messages = eslint.verify(topic, config);
				assert.equal(messages.length, 0);
			});
		});
	});
});