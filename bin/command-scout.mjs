#!/usr/bin/env node
/**
 * command-scout CLI launcher.
 */
import { main } from '../src/cli.js'

const code = await main(process.argv.slice(2))
process.exitCode = code
