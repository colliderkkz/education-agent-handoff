import { effectiveHelpLabel } from './evidenceView';
import { Text, View } from 'react-native';
import type { EvidencePreview } from '../../local/types';
import { styles } from '../../theme';
import { Badge, Card } from '../ui';
import { knowledgeNames, learningStyles as ls, Notice } from './LearnUI';

export function EvidenceImpact({ preview }: { preview: EvidencePreview }) {
  const { before, after } = preview;
  return <Card style={ls.section}><Badge>确认前 · 本次影响预览</Badge><Text style={styles.sectionTitle}>{preview.outcome === 'accept' ? '应用这份本机核对' : '保留原结果，不采用这份申请'}</Text>
    <Text style={styles.body}>这次由本人在本机核对，不是可信教师复核，也不会凭自述增加独立新题星级。</Text>
    <Text selectable style={styles.body}>当前答案：{before.answer || '未填写'} → 核对后：{after.answer || '未填写'}</Text>
    <Text style={styles.body}>{effectiveHelpLabel(before)} → {effectiveHelpLabel(after)}</Text>
    <Text style={styles.body}>{knowledgeNames[before.knowledgeId]} → {knowledgeNames[after.knowledgeId]} · {after.valid ? after.correct ? '回答正确' : '未答对' : '标记无效，不纳入当前统计'}</Text>
    <Text style={styles.body}>报告答对：{preview.report.beforeCorrect} → {preview.report.afterCorrect}；独立答对：{preview.report.beforeIndependent} → {preview.report.afterIndependent}；无效记录 {preview.report.invalidatedCount} 条。</Text>
    <Text style={styles.caption}>这里的独立答对是帮助标签统计，不等于可用于升星的独立新题证据。</Text>
    <Text style={styles.body}>错题记录：{preview.mistake.beforeActive ? '属于当前错题' : '不属于当前错题'} → {preview.mistake.afterActive ? '属于当前错题' : '不属于当前错题'}。已有学习订正和原答案仍保留。</Text>
    {preview.knowledge.map(item => <View key={item.knowledgeId}><Text style={ls.label}>{knowledgeNames[item.knowledgeId]}：{item.beforeStars === null ? '待评估' : `${item.beforeStars} 星`} → {item.afterStars === null ? '待评估' : `${item.afterStars} 星`}</Text><Text style={styles.caption}>{item.reason}</Text></View>)}
    {preview.reviewPlans.map(item => <View key={item.planId}><Text style={ls.label}>{knowledgeNames[item.knowledgeId]}复查来源：{item.afterValid ? '有效' : '需核对'}</Text><Text style={styles.caption}>{item.reason}</Text></View>)}
    {preview.warnings.map((warning, i) => <Notice key={i} text={warning} />)}
    <Text style={styles.caption}>只追加决定与新评定。原始作答、旧报告结果、旧评定及实际帮助记录不覆盖；学习订正另行保留。</Text>
  </Card>;
}
