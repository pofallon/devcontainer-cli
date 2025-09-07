/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as path from 'path';
import { devContainerUp, devContainerDown, shellExec, shellBufferExec } from './testUtils';

const pkg = require('../../package.json');

describe('Dev Containers CLI enter command', function () {
	this.timeout('240s');

	const tmp = path.relative(process.cwd(), path.join(__dirname, 'tmp'));
	const cli = `npx --prefix ${tmp} devcontainer`;

	before('Install', async () => {
		await shellExec(`rm -rf ${tmp}/node_modules`);
		await shellExec(`mkdir -p ${tmp}`);
		await shellExec(`npm --prefix ${tmp} install devcontainers-cli-${pkg.version}.tgz`);
	});

	describe('enter basic usage', () => {
		let containerId: string | null = null;
		const testFolder = `${__dirname}/configs/image`;
		beforeEach(async () => { containerId = (await devContainerUp(cli, testFolder, { useBuildKit: false })).containerId; });
		afterEach(async () => { await devContainerDown({ containerId }); });

		it('should enter and run login shell (prints user)', async () => {
			const res = await shellExec(`${cli} enter --workspace-folder ${testFolder} -- -c 'whoami'`);
			assert.strictEqual(res.error, null);
			assert.match(res.stdout, /vscode|root|node/); // depending on test image
		});

		it('should run command with --shell override', async () => {
			// Use /bin/sh -c echo hi explicitly
			const res = await shellBufferExec(`${cli} enter --workspace-folder ${testFolder} --shell /bin/sh -- -c 'echo hi'`);
			assert.strictEqual(res.code, 0);
			assert.ok(res.stdout.toString().includes('hi'));
		});

		it('should respect DEVCONTAINER_ENTER_SHELL when no --shell provided', async () => {
			// Set env variable to /bin/sh and run a simple echo
			const res = await shellBufferExec(`DEVCONTAINER_ENTER_SHELL=/bin/sh ${cli} enter --workspace-folder ${testFolder} -- -c 'echo envshell'`);
			assert.strictEqual(res.code, 0);
			assert.ok(res.stdout.toString().includes('envshell'));
		});

		it('should have --shell take precedence over DEVCONTAINER_ENTER_SHELL', async () => {
			// Intentionally set env var to /bin/false (will fail if used) and override with /bin/sh
			const res = await shellBufferExec(`DEVCONTAINER_ENTER_SHELL=/bin/false ${cli} enter --workspace-folder ${testFolder} --shell /bin/sh -- -c 'echo override'`);
			assert.strictEqual(res.code, 0);
			assert.ok(res.stdout.toString().includes('override'));
		});

		it('should pass through arguments after -- to chosen shell', async () => {
			// Validate that the -c argument goes to the shell (already indirectly tested, but explicit)
			const res = await shellBufferExec(`${cli} enter --workspace-folder ${testFolder} -- -c 'echo passthrough'`);
			assert.strictEqual(res.code, 0);
			assert.ok(res.stdout.toString().includes('passthrough'));
		});
	});
});
