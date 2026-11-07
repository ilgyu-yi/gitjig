# Local development

Audience: developers preparing local Git changes. These operations do not require an agent plan, model or execution engine. Running isolated project checks still requires the [execution setup](startup.md). Local preferences do not replace your repository's actual rules.

## Use the terminal

Select or register the intended project with `/project`, then open `/local` (also available from `/ready`). The menu shows the exact project and source directory. It works without a model or execution engine. Native Git process-group ownership supports macOS and Linux, including WSL; native Windows is unavailable.

Inspection and preparation screens start with a readable outcome and the next useful step. Git paths distinguish staged, unstaged, untracked and conflicting changes; preparation lists the configured rules that passed or need attention. Scroll to **Original observation · details** for the captured record. Reading or scrolling these screens does not run another check or change the project.

Check reviews show the exact command, isolated directory, active runtime and allowance before the separate Run or Resume choice. **Inspect original result and output** in a retained check shows the result's original command and output without another attempt. Long output has an explicit preview limit. The trusted Git path you enter is reused within the open local-tools menu; each operation still validates it.

- **Inspect Git changes and history** asks for a trusted Git executable outside application storage and registered projects. It reports staged/unstaged/untracked/conflicting paths, branch and recent commits. This is a status/history observation; review actual diffs with trusted Git.
- **Inspect local conventions** shows applied rules and their revision. Missing configuration remains NOT_CONFIGURED.
- **Edit local conventions** stages protected branch names, allowed prefixes/types, subject length and body requirements with plain fields. Add/remove exact literals without JSON. Empty lists impose no restriction for that field. Invalid values preserve the staged edit. Recommended values are a starting point; **Save staged conventions** is the explicit application action. Cancelling saves nothing. A changed source or convention file refuses the stale save.
- **Prepare staged change** uses the configured rules, explicit trusted Git and an owned UTF-8 message-file path. Its result separates each rule outcome and preserves false/zero/unknown distinctions. No raw message body is displayed. Missing rules cannot produce a preparation pass.

- **Run new isolated check** asks for the exact command and `/work` (read-only captured project) or `/scratch` (mutable scratch). Review the active runtime and allowance, then explicitly start. It needs active execution setup, but no model. In `/setup runtime`, choose **Save and apply runtime** to use it for subsequent checks without restarting. Existing checks keep their captured runtime. A `/scratch` result cannot establish source correspondence.
- **Retained local checks** lists this project's original checks without running them. Inspect original command, runtime, result, cleanup and allowance. **Resume original check** previews a new attempt under the active runtime and preserves the same work, command, cwd and consumed allowance. Cancelled work requires explicit confirmation. Uncertain or unsettled work requires original recovery through `/work`; starting replacement work does not resolve it. **Inspect current check correspondence** compares the original successful result with current source/index. **Record exact commit candidate** asks for trusted Git and an owned exact message file, then requires explicit recording. Changed original work refuses.

- **Retained candidates and commit audit** discovers historical receipts without creating storage or work. Inspect an original receipt, or enter a native commit reference and explicitly audit it. The selected receipt remains bound across forms and asynchronous reads; replacement refuses. MATCH means historical tree/message/parent/check correspondence. MISMATCH retains the actual native commit and names the differing checks. Neither result grants current eligibility or review approval.

These actions do not stage, commit, push or grant review approval. Make the commit separately with trusted native Git and the exact recorded message file; existing hooks and signing still apply. Then audit through the terminal menu or CLI entries below. Saving rules belongs to the selected project even if you navigate afterward. Native observation needs stable trusted Git configuration. Each native command has a five-second/1-MiB bound and up to two seconds to confirm cleanup. Shutdown cancels and joins the owned native process group; if termination cannot be confirmed, the error identifies that group and reports cleanup uncertainty. It does not claim rollback or absence of helper effects.

## Follow repository guidance

Obtain the current native policy observations from [repository inspection](repository-inspection.md), using your own read credential or an attributed result from the administrator. Keep the provider/API base, repository identity, selected branch/head and unavailable facets with that guidance. Explicitly associate it with your actual local clone and starting commit; choosing a project does not retarget a global repository configuration plan.

Select local branch/message conventions and a meaningful check command explicitly. Local conventions are not translated from hosting settings automatically. Use your own application home and Git identity; administrator credentials and permissions are not needed for independent local checks, preparation, commit or audit. Make the commit separately with native Git and then inspect its correspondence. A local audit MATCH does not satisfy hosting approvals, pipelines, discussions, account permissions or merge eligibility. Missing policy observations remain unknown even when independent local work succeeds.

## Configure conventions

Register the exact canonical worktree root with `gitjig project register --id example --root /absolute/project --home /absolute/gitjig-home`. Then inspect `gitjig local conventions --project example --home /absolute/gitjig-home`. An unconfigured project reports NOT_CONFIGURED and revision 0. Recommendations are optional and never apply automatically.

Create a private profile outside every registered project:

```sh
umask 077
gitjig local recommend > /absolute/private/local-rules.json
```

Edit the profile, then apply it with `gitjig local configure --project example --revision 0 --profile /absolute/private/local-rules.json --home /absolute/gitjig-home`. Use the current inspected revision for later changes. A stale revision refuses without replacing the saved rules. Configuration belongs to the selected gitjig home and project; it is not committed to the project or installed as a Git hook.

| Field | Behavior |
| --- | --- |
| `protectedBranches` | Exact names on which preparation fails. The recommendation lists main and master. |
| `branchPrefixes` | Literal allowed prefixes. An empty list permits any prefix. Include the slash when you mean a branch family, such as feat/. |
| `commitTypes` | Lowercase allowed types. An empty list imposes no type format. Configured types accept feat: description, feat(ui): description and feat(ui)!: description. |
| `subjectMaxLength` | Maximum subject length in Unicode code points, from 1 to 256. The recommendation is 72. |
| `requireBody` | Whether nonblank body text is required after a blank separator. The recommendation is false. |

All five fields are required. Lists contain at most 32 distinct literals; wildcards, executable rules and arbitrary regular expressions are unsupported. The type check implements the listed subject forms, not the full Conventional Commits specification. Rules retain the source directory identity. Replacing that directory does not silently apply the old project's configuration; register the replacement with a distinct project ID.

## Prepare a change

Stage the intended changes with trusted Git. Save the intended commit message in an owned regular UTF-8 file, without symlinks or shared write permissions. The file can be in the project, is limited to 64KiB and is not staged automatically.

```sh
gitjig local prepare --project example \
  --git-binary /absolute/trusted/git \
  --message-file /absolute/commit-message.txt \
  --home /absolute/gitjig-home
```

The JSON result reports each rule and the applied convention revision/hash. Exit 0 means PASS, exit 1 means FAIL and exit 2 means UNAVAILABLE or an entry error. Missing rules do not pass. A changed rule file, source identity or message requires fresh preparation. A detached HEAD refuses branch preparation. A named branch before its first commit is supported. Conflicts fail; at least one staged change is required. Unstaged and untracked files remain visible observations and are not included automatically.

Use a nonempty subject without surrounding whitespace, controls or a byte-order mark. Put a blank second line before body text. CRLF is accepted for validation; the message digest always covers the original bytes. Comments are literal text and no Git message cleanup is applied. Normal output includes the message digest and length, not its private body. The observation ID identifies the returned observation, not a content-addressed candidate.

A preparation pass covers configured preparation rules only. Review the actual staged diff and run meaningful [local checks](usage.md#local-checks-and-repository-rules). Preparation runs no checks, review, hooks or commit and grants no repository approval. Changed files or messages need fresh verification.

## Inspect check correspondence

Run an applicable command with `local check --project example --command 'your check command'` and the saved or explicit execution setup. Its output identifies the original work and run. After settlement, inspect that original work:

In `/local`, a finished check shows its command outcome, cleanup and original run, then **Next step for this check**. A successful, settled `/work` check offers current correspondence inspection and exact candidate recording directly from that result. These are separate explicit actions; success alone does not prove the staged files still match. **Return to local tools** closes the result without another attempt. **Inspect original receipt** retains access to output and limitations; long displays are shortened. If the original check changes while the result is open, reopen its retained record before continuing.

```sh
gitjig local evidence --project example --work WORK_ID \
  --git-binary /absolute/trusted/git --home /absolute/gitjig-home
```

This operation requires no model or execution engine. It can inspect retained evidence even when saved startup setup needs repair. It executes no new check and spends no execution allowance. It uses the same work/run/result and original recorded runtime, rather than new defaults. Resumed checks must retain their original work; their new run and consumed allowance remain visible.

The original command must have succeeded in /work with confirmed cleanup. Failed, cancelled, uncertain and pending work is unavailable, as are commands started in /scratch. Same-lineage unsettled producers also block correspondence. The report preserves the exact command/cwd and input identities. Scratch remains mutable-or-unknown even for /work commands; this report does not infer all their dependencies. A successful command such as true does not prove that testing was adequate; assess what the command actually verifies.

Exit 0 and CURRENT mean that the current full capture equals the tested capture and every staged regular file matches its private captured raw bytes and executable mode. Exit 1 and STALE mean that source or staged content differs. Exit 2 means unavailable evidence, unsupported input or an entry failure. Mismatch paths are limited to 100 with a remaining count. Intent-to-add, conflicts, symlinks and gitlinks cannot receive CURRENT. Raw EOL conversion differences are reported as mismatches even if ordinary Git status hides them.

The full capture includes Git metadata, ignored files and untracked files. Changes to any of them conservatively make the source evidence stale. Captured non-index files remain execution context; they are not claimed as committed product. Source capture retains its registered finite entry/byte limits. The inspection has a 30-second overall bound, joins capture shutdown and removes temporary input after confirmed termination. Cleanup uncertainty retains the exact private path for explicit recovery.

This read is non-atomic. The index fingerprint is not a commit lock or authorization. Use the optional receipt and audit path below to connect this evidence to a native human commit. A receipt does not lock source or authorize a commit. Gitjig does not provide a general human commit/push gate; agent-governed actions retain their own acceptance boundary.

Native Git inspection requires stable trusted repository configuration. Stop tools that change it during preparation. Preflight refuses observed content filters and partial clones, but is not a sandbox against concurrent reconfiguration. A later refusal cannot prove that no helper ran. The [inspection limits](usage.md#local-checks-and-repository-rules) also apply here. Agent execution retains its separate sandbox and procedure requirements.

## Record, commit and audit

For a human local workflow, Git makes the commit and gitjig records which prepared content matches the original check. Keep your existing Git hooks and signing configuration. This path adds no agent planning or review ceremony.

Before the check, prepare an owned message file with LF line endings and a final LF. For example, use `printf 'Describe the change\n' > /absolute/private/commit-message.txt` after `umask 077`. Comments are literal text. Candidate recording refuses CRLF or a missing final LF rather than silently normalizing bytes; `local prepare` alone accepts CRLF for rule validation. Prefer a message file outside the project so editing it does not change captured source context. Configure conventions, stage the intended changes, run preparation, and run an applicable `/work` local check. Then record its exact current candidate:

```sh
gitjig local candidate --project example --work WORK_ID \
  --message-file /absolute/private/commit-message.txt \
  --git-binary /absolute/trusted/git --home /absolute/gitjig-home
```

The result reports RECORDED and a candidate UUID. It binds the entire index file/directory roster, raw file content identities and executable modes, expected parent, intended branch, message digest, conventions and original work/run/result/observation/capture. It saves no message body. Records belong to this home and physical project directory. Creation requires current successful original evidence and unchanged preparation inputs; it does not run a new check or spend execution allowance.

Review the staged diff, then commit with native Git using the exact message file and verbatim cleanup:

```sh
/absolute/trusted/git -C /absolute/project commit --cleanup=verbatim \
  -F /absolute/private/commit-message.txt
gitjig local audit --project example --candidate CANDIDATE_UUID --commit COMMIT_REF \
  --git-binary /absolute/trusted/git --home /absolute/gitjig-home
```

Use the actual commit ID when retaining a result; a reference such as HEAD is resolved once and the output identifies the exact observed commit. Normal native signing and hooks still apply. A hook that changes staged content or message can cause MISMATCH even though Git committed successfully. Audit leaves that commit intact. Inspect the differences and run applicable checks for a new intended candidate rather than assuming the old check covers the change.

Exit 0 and MATCH mean historical correspondence of the whole tree, exact message, normal single parent (or no parent for an initial commit), and original retained evidence. Exit 1 and MISMATCH report which content bindings differ. Exit 2 means unavailable input, evidence or observation. An amendment or merge receives no implicit exception. Changed current work, branch or conventions are shown separately; they do not overwrite historical evidence or make it current. Git author/committer values are unverified metadata. The intended branch is preparation context, not proof of where the commit was created.

Find retained records with `gitjig local candidates --project example --home /absolute/gitjig-home`; no model, engine or Git binary is required to list them. The list reports IDs, check references, intended tree/parent and convention identities. Unsafe or malformed records are unavailable, including records whose project cannot be read. Listing is bounded to 1000 receipts per home; archive owned old receipts outside the active receipt directory if the bound is reached. Do not edit receipts to manufacture acceptance.

Neither MATCH nor RECORDED establishes test adequacy, independent review, current eligibility or repository approval. Original captures can include ignored/untracked inputs that the commit does not contain; the committed tree alone is not claimed to reproduce the command. Follow the repository's actual review and permission rules separately. Whole-workflow and installed/provider qualification remain subject to the [capability limits](capabilities.md).

An audit is a read-only observation, not a saved audit receipt. The original candidate remains retained. After reopening, choose **Audit native commit** again for a fresh comparison with the explicit commit reference.
