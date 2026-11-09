import { Text, View } from 'react-native';
import { Card } from '../ui';
import { colors, styles } from '../../theme';
import { learningStyles as ls } from './LearnUI';

export const masteryLevelNames = ['讲解后理解关键步骤', '提示下完成', '基础题独立完成', '多情境稳定完成', '间隔后独立迁移'];
export function MasteryLegend() {
  return <Card style={ls.section}><Text style={styles.sectionTitle}>五星分别说明什么？</Text>{masteryLevelNames.map((name, i) => <View key={name} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}><View style={{ width: 31, height: 31, borderRadius: 10, backgroundColor: colors.primaryLight, justifyContent: 'center', alignItems: 'center' }}><Text style={[ls.label, { color: colors.primary }]}>{i + 1}</Text></View><Text style={[styles.body, { flex: 1 }]}>{name}</Text></View>)}<Text style={styles.caption}>星级由已保存的作答依据与当前规则计算。尚未学习、待评估是单独状态，不用零星表示；这套规则仍用于本机试验，不作为正式学业评价。</Text></Card>;
}
