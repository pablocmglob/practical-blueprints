#!/usr/bin/env node
/** run_tests.py — test runner entry point. The implementation lives in
 * run_tests_impl.cjs (Node rejects requiring a .py extension). */
"use strict";
const path = require("path");
require(path.join(__dirname, "run_tests_impl.cjs"));
