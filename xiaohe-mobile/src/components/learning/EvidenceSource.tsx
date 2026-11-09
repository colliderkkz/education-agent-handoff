import { useState } from 'react';
import { Image, Text, View } from 'react-native';
import type { Evidence, WorkspaceState } from '../../local/types';
import { localPhotoUri } from '../../features/local-photo';
import { styles } from '../../theme';
import { Badge, Button, Card } from '../ui';
import { Chip, helpNames, knowledgeNames, learningStyles as ls } from './LearnUI';
import { fullDateTime } from './reviewTime';

/** The submitted snapshot is deliberately separate from any later effective result. */
export function EvidenceSource({ evidence, state }: { evidence: Evidence; state: WorkspaceState }) {
  const paper = state.papers.find(item => item.id === evidence.paperId);
  const attempt = state.attempts.find(item => item.id === evidence.attemptId);
  const answer = attempt?.answers.find(item => item.questionId === evidence.questionId);
  const questionNumber = paper?.questionIds.indexOf(evidence.questionId);
  return <Card style={ls.section}><Badge>原始提交 · 保留不覆盖</Badge>
    <Text style={styles.sectionTitle}>{paper?.title || '原始作答记录'}</Text>
    <Text style={styles.caption}>{questionNumber !== undefined && questionNumber >= 0 ? `第 ${questionNumber + 1} 题 · ` : ''}题目 v{evidence.questionVersion}{paper ? ` · 试卷 v${paper.version}` : ''}</Text>
    <Text style={ls.question}>{evidence.questionText}</Text>
    <Text selectable style={styles.body}>原始答案：{evidence.answer || '未填写'}</Text>
    {!!answer?.working && <Text selectable style={styles.body}>原始思路：{answer.working}</Text>}
    <Text style={styles.body}>{evidence.correct ? '原判定：回答正确' : '原判定：未答对'} · {helpNames[evidence.help]}</Text>
    <Text style={styles.caption}>{knowledgeNames[evidence.knowledgeId]} · {fullDateTime(evidence.createdAt)}{evidence.provenance === 'paper' ? ' · 纸面自述未核实' : ''}</Text>
    <Text style={styles.caption}>这里核对提交时的记录。后来学会后的新答案，请在错题页做“学习订正”。</Text>
  </Card>;
}

export function EvidenceAttachments({ state, selected, onChange, disabled }: { state: WorkspaceState; selected: string[]; onChange: (ids: string[]) => void; disabled: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const uploads = state.uploads.filter(item => item.purpose === 'homework');
  return <Card style={ls.section}><Text style={styles.sectionTitle}>核对原稿（可选）</Text>
    <Text style={styles.caption}>可关联已保存的本机纸面图片，最多 10 张。请核对卷名、题号和原答案；图片不会自动识别，也不代表已获教师复核。</Text>
    <Button label={expanded ? '收起本机原稿' : `选择本机已保存原稿 · 已选 ${selected.length} 张`} secondary disabled={disabled} onPress={() => setExpanded(value => !value)} />
    {expanded && uploads.map(upload => <View key={upload.id} style={ls.section}>
      <Image accessibilityLabel={`核对原稿：${upload.name}`} source={{ uri: localPhotoUri(upload.url) }} resizeMode="contain" style={{ width: '100%', height: 210, backgroundColor: '#F3F6EE', borderRadius: 12 }} />
      <Text style={styles.caption}>{upload.name}</Text>
      <Chip text={selected.includes(upload.id) ? '已关联 · 点击取消' : '确认这是本题原稿'} selected={selected.includes(upload.id)} disabled={disabled || selected.length >= 10 && !selected.includes(upload.id)} onPress={() => onChange(selected.includes(upload.id) ? selected.filter(id => id !== upload.id) : [...selected, upload.id])} />
    </View>)}
    {expanded && !uploads.length && <Text style={styles.body}>尚无本机纸面原稿。可以先保存文字申请，图片不是必填项。</Text>}
  </Card>;
}
