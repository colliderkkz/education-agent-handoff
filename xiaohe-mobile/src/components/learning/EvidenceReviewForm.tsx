import { Text, TextInput, View } from 'react-native';
import type { HelpLevel, WorkspaceState } from '../../local/types';
import { styles } from '../../theme';
import { Badge, Card } from '../ui';
import { Chip, helpNames, learningStyles as ls } from './LearnUI';
import { EvidenceAttachments } from './EvidenceSource';
import type { EvidenceReviewInput } from './evidenceReviewInput';

export function EvidenceReviewForm({ input, state, disabled, onChange }: { input: EvidenceReviewInput; state: WorkspaceState; disabled: boolean; onChange: (next: EvidenceReviewInput) => void }) {
  const update = (patch: Partial<EvidenceReviewInput>) => onChange({ ...input, ...patch });
  return <><Card style={ls.section}><Badge>本人申请 · 尚不改变报告</Badge><Text style={styles.sectionTitle}>需要核对什么？</Text><Text style={styles.caption}>只选择需要更正的字段。没有勾选的记录保持原样。请描述原来发生的事实，不填写后来订正的答案。</Text>
    <Chip text="原稿答案录入有误" selected={input.changeAnswer} disabled={disabled} onPress={() => update({ changeAnswer: !input.changeAnswer })} />
    {input.changeAnswer && <><Text style={ls.label}>提交时实际写下的答案</Text><TextInput accessibilityLabel="更正后的原始答案" style={ls.input} value={input.answer} onChangeText={answer => update({ answer })} editable={!disabled} maxLength={300} placeholder="原稿留空时，也可以保留空白" placeholderTextColor="#87937D" /><Text style={styles.caption}>最多 300 字；对照原稿核对数字、符号与单位。空白会作为原稿未作答处理。</Text></>}
    <Chip text="帮助情况需要核对" selected={input.changeHelp} disabled={disabled} onPress={() => update({ changeHelp: !input.changeHelp })} />
    {input.changeHelp && <><View style={ls.wrap}>{(['unknown', 'independent', 'hint', 'explanation'] as HelpLevel[]).map(help => <Chip key={help} text={help === 'independent' ? '本人称独立（未核实）' : helpNames[help]} selected={input.help === help} disabled={disabled} onPress={() => update({ help })} />)}</View><Text style={styles.caption}>本人自述不能取消 App 已记录的提示或讲解，也不会转为可信的独立升星依据。</Text></>}
    <Chip text="知识点归属需要核对" selected={input.changeKnowledge} disabled={disabled} onPress={() => update({ changeKnowledge: !input.changeKnowledge })} />
    {input.changeKnowledge && <View style={ls.wrap}>{state.knowledge.map(item => <Chip key={item.id} text={item.name} selected={input.knowledgeId === item.id} disabled={disabled} onPress={() => update({ knowledgeId: item.id })} />)}</View>}
    <Chip text="这条证据是否纳入结果" selected={input.changeValidity} disabled={disabled} onPress={() => update({ changeValidity: !input.changeValidity })} />
    {input.changeValidity && <View style={ls.wrap}><Chip text="标记无效，原记录留档" selected={input.invalidated} disabled={disabled} onPress={() => update({ invalidated: true })} /><Chip text="恢复为有效记录" selected={!input.invalidated} disabled={disabled} onPress={() => update({ invalidated: false })} /></View>}
    <Text style={ls.label}>依据和原因（必填）</Text><TextInput accessibilityLabel="证据更正原因" style={[ls.input, ls.textArea]} multiline value={input.reason} editable={!disabled} onChangeText={reason => update({ reason })} maxLength={1000} placeholder="例如：原稿第 2 题写的是 8，手工录入时写成了 9。" placeholderTextColor="#87937D" />
  </Card><EvidenceAttachments state={state} selected={input.uploadIds} disabled={disabled} onChange={uploadIds => update({ uploadIds })} /></>;
}
