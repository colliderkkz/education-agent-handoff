import test from 'node:test';
import assert from 'node:assert/strict';
import { createEvidenceInput, evidenceInputKey, evidenceInputPatch, findSavedDecision, findSavedProposal, inputFromProposal, validateEvidenceInput } from '../src/components/learning/evidenceReviewInput.ts';

const evidence = { id: 'e1', answer: '9', help: 'hint', knowledgeId: 'division' };
const proposal = { id: 'p1', evidenceId: 'e1', requestedBy: 'student', requestId: 'save-one', patch: { answer: '8' }, reason: '原稿写的是8，录入错误', uploadIds: ['photo-1'] };

test('unselected fields are omitted, including an untouched help label; explicit blank answers and false validity patches survive', () => {
  const input = createEvidenceInput(evidence);
  assert.deepEqual(evidenceInputPatch(input), {});
  input.answer = ''; input.changeAnswer = true; input.changeValidity = true;
  assert.deepEqual(evidenceInputPatch(input), { answer: '', invalidated: false });
  input.changeAnswer = false;
  assert.deepEqual(evidenceInputPatch(input), { invalidated: false });
  assert.equal(input.answer, ''); // Toggling a field off does not erase the user's unfinished value.
  assert.equal(evidence.answer, '9');
});
test('saving requires an explicit field and a nonblank reason; optional attachments are bounded', () => {
  const input = createEvidenceInput(evidence);
  assert.match(validateEvidenceInput(input), /字段/);
  input.changeHelp = true; input.help = 'independent';
  assert.match(validateEvidenceInput(input), /原因/);
  input.reason = '本人回看原稿'; assert.equal(validateEvidenceInput(input), null);
  input.uploadIds = Array.from({ length: 11 }, (_, i) => `photo-${i}`);
  assert.match(validateEvidenceInput(input), /10/);
});
test('a selected answer of 301 characters is blocked before persistence, while the exact 300-character limit is allowed', () => {
  const input = { ...createEvidenceInput(evidence), changeAnswer: true, answer: '字'.repeat(301), reason: '按原稿核对' };
  assert.match(validateEvidenceInput(input), /300/);
  input.answer = '字'.repeat(300); assert.equal(validateEvidenceInput(input), null);
  input.answer = '字'.repeat(301); input.changeAnswer = false; input.changeHelp = true;
  assert.equal(validateEvidenceInput(input), null); // An unselected field is not submitted.
});
test('persisted proposal resumes exactly the selected patch, and modifying resumed input never rewrites that proposal', () => {
  const input = inputFromProposal(proposal, evidence);
  assert.deepEqual(evidenceInputPatch(input), { answer: '8' });
  assert.equal(input.changeHelp, false); assert.equal(input.help, 'hint');
  input.uploadIds.push('photo-2'); input.reason = '补充原因';
  assert.deepEqual(proposal.uploadIds, ['photo-1']); assert.equal(proposal.reason, '原稿写的是8，录入错误');
  assert.notEqual(evidenceInputKey(input), evidenceInputKey(inputFromProposal(proposal, evidence)));
});
test('unknown proposal/decision results can only be claimed by the same evidence, actor and stable request id', () => {
  assert.equal(findSavedProposal([proposal], 'e1', 'save-one', 'student'), proposal);
  assert.equal(findSavedProposal([proposal], 'other', 'save-one', 'student'), undefined);
  assert.equal(findSavedProposal([proposal], 'e1', 'save-two', 'student'), undefined);
  assert.equal(findSavedProposal([proposal], 'e1', 'save-one', 'another'), undefined);
  const decision = { id: 'd1', evidenceId: 'e1', actorId: 'student', requestId: 'confirm-one' };
  assert.equal(findSavedDecision([decision], 'e1', 'confirm-one', 'student'), decision);
  assert.equal(findSavedDecision([decision], 'e1', 'confirm-two', 'student'), undefined);
  assert.equal(findSavedDecision([decision], 'e1', 'confirm-one', 'another'), undefined);
});
