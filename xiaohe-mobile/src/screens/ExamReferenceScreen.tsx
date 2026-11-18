import { router } from 'expo-router';
import { Linking, Text, View } from 'react-native';
import { Screen } from '../components/Screen';
import { Button, Card } from '../components/ui';
import { learningStyles as ls } from '../components/learning/LearnUI';
import { examIndexDisclaimer, examTopics, paperTemplates, sourceTierLabels } from '../local/shared/exam-references.ts';
import { styles } from '../theme';

/**
 * 真题考情与出处索引。
 *
 * 这里**不放真题原文** —— 上海市教育考试院只发布试卷的「专家点评」，从不发布试卷原件；
 * 商业题库站上的「真题」多为回忆版，版权归属不明。
 * 能给的是：官方公布的考点出处（年份 → 题号 → 考点）与卷面结构。
 */
export default function ExamReferenceScreen() {
  const back = () => router.canGoBack() ? router.back() : router.replace('/');
  const byYear = new Map<number, typeof examTopics[number]['hits']>();
  for (const topic of examTopics) {
    for (const hit of topic.hits) {
      const list = byYear.get(hit.year) ?? [];
      list.push(hit);
      byYear.set(hit.year, list);
    }
  }
  const years = [...byYear.keys()].sort((a, b) => b - a);
  return <Screen title="真题考情与出处索引" onBack={back}>
    <View><Text style={styles.eyebrow}>EXAM CONTEXT</Text><Text style={styles.title}>真题考情与{ '\n' }出处索引</Text><Text style={styles.subtitle}>这里不收录真题原文，只给官方公布的出处与卷面结构 —— 想做原卷，请通过学校或正规渠道获取。</Text></View>
    <Card style={ls.section}><Text style={styles.body}>{examIndexDisclaimer}</Text></Card>
    <Card style={ls.section}><Text style={styles.sectionTitle}>卷面结构</Text><Text style={styles.caption}>官方公布的时长与分值，以及题型分布的来源等级。</Text>
      {paperTemplates.map(template => <View key={template.id} style={ls.section}><Text style={styles.body}>{template.label} · {template.totalScore} 分 · {template.minutes} 分钟</Text><Text style={styles.caption}>官方公布：{template.officialFacts.join('；')}</Text><Text style={styles.caption}>第三方口径：{template.thirdPartyFacts.join('；')}</Text><Button label="打开官方来源" secondary onPress={() => { void Linking.openURL(template.source.url); }} /><Text style={styles.caption}>{template.source.title} · {sourceTierLabels[template.source.tier]}</Text></View>)}
    </Card>
    <Card style={ls.section}><Text style={styles.sectionTitle}>考点出处索引</Text><Text style={styles.caption}>来自上海市教育考试院各年「专家点评」—— 有题号的写到题号，没有的只到情境。</Text>
      {years.map(year => <View key={year} style={ls.section}><Text style={styles.body}>{year} 年</Text>{[...new Map(byYear.get(year)!.map(hit => [hit.topic, hit])).values()].map(hit => <View key={hit.topic} style={ls.section}><Text style={styles.body}>{hit.topic} · {hit.questionNo ? `第 ${hit.questionNo} 题` : '官方未点名题号'}</Text><Button label="官方点评原文" secondary onPress={() => { void Linking.openURL(hit.source.url); }} /></View>)}</View>)}
    </Card>
    <Card style={ls.section}><Text style={styles.sectionTitle}>我们的题对应哪些考点</Text><Text style={styles.caption}>题库里的原创题按知识点挂到下面的考点上 —— 是「覆盖同一考点」，不是原题改编。</Text>
      {examTopics.map(topic => <View key={topic.key} style={ls.section}><Text style={styles.body}>{topic.label}</Text><Text style={styles.caption}>出处：{topic.hits.map(hit => `${hit.year} 年${hit.questionNo ? ` 第 ${hit.questionNo} 题` : ''}`).join('、')}</Text></View>)}
    </Card>
    <Button label="回到首页" secondary onPress={() => router.replace('/')} />
  </Screen>;
}
