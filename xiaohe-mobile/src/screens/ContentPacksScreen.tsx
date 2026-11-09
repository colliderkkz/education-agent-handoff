import { useRef, useState } from 'react';
import { router, usePreventRemove } from 'expo-router';
import { Alert, Text, TextInput, View } from 'react-native';
import { Screen } from '../components/Screen';
import { Badge, Button, Card } from '../components/ui';
import { errorMessage, knowledgeNames, learningStyles as ls, LoadingPanel, Notice } from '../components/learning/LearnUI';
import { fullDateTime } from '../components/learning/reviewTime';
import { useLearning } from '../context/LearningContext';
import { pickContentFile } from '../local/content-file';
import type { ContentBatch, ContentPreview } from '../local/types';
import { styles } from '../theme';

type SelectedFile = { name: string; json: string };
type Operation = 'pick' | 'preview' | 'apply' | 'reload' | 'rollback' | null;
const actionNames = { add: '新增', update: '更新', withdraw: '停用', unchanged: '保持不变' };
const taskNames = { basic: '基础题', application: '应用题', transfer: '迁移题' };

export default function ContentPacksScreen() {
  const { state, loading, error, busy, act, reload } = useLearning();
  const [selected, setSelected] = useState<SelectedFile | null>(null);
  const [preview, setPreview] = useState<ContentPreview | null>(null);
  const [previewReady, setPreviewReady] = useState(false);
  const [working, setWorking] = useState<Operation>(null);
  const [failure, setFailure] = useState(''), [notice, setNotice] = useState('');
  const [details, setDetails] = useState(false), [expandedBatch, setExpandedBatch] = useState<string | null>(null);
  const [rollbackId, setRollbackId] = useState<string | null>(null);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [confirmation, setConfirmation] = useState<{ batchId: string; revision: number } | null>(null);
  const operation = useRef(false);
  const locked = !!working || busy || loading;
  usePreventRemove(!!working, () => Alert.alert('正在处理内容包', '请等这次操作完成后再离开，已选文件和输入会留在当前页面。'));
  const back = () => {
    if (operation.current) { Alert.alert('正在处理内容包', '请等这次操作完成后再离开。'); return; }
    if (router.canGoBack()) router.back(); else router.replace('/profile');
  };
  const begin = (value: Exclude<Operation, null>) => {
    if (operation.current || locked) return false;
    operation.current = true; setWorking(value); setFailure(''); setNotice(''); return true;
  };
  const finish = () => { operation.current = false; setWorking(null); };
  const makePreview = async (file: SelectedFile) => {
    setPreviewReady(false);
    const result = await act('local.content.preview', { json: file.json });
    const next = result.result?.preview as ContentPreview | undefined;
    if (!next || !next.counts || !Array.isArray(next.changes)) throw new Error('没有取得完整的内容包预览。文件仍在，请重新读取并预览。');
    setPreview(next); setPreviewReady(true);
  };
  const selectFile = async () => {
    if (!begin('pick')) return;
    try {
      const file = await pickContentFile();
      if (!file) return;
      setSelected(file); setPreview(null); setPreviewReady(false); setDetails(false); setConfirmation(null);
      setWorking('preview'); await makePreview(file);
    } catch (cause) { setFailure(errorMessage(cause)); }
    finally { finish(); }
  };
  const refresh = async () => {
    if (!begin('reload')) return;
    setPreviewReady(false); setConfirmation(null);
    try {
      await reload();
      if (selected) { setWorking('preview'); await makePreview(selected); }
      setNotice(selected ? '已重读本机记录并重新预览。所选文件和回退原因均保留。' : '已重读本机题库记录，回退原因保留。');
    } catch (cause) { setFailure(errorMessage(cause)); }
    finally { finish(); }
  };
  const batches = state?.content?.batches || [];
  const latestApplied = [...batches].reverse().find(batch => batch.status === 'applied');
  const selectedBatch = preview ? batches.find(batch => batch.packageId === preview.packageId && batch.digest === preview.digest) : undefined;
  const alreadyApplied = preview?.alreadyApplied || selectedBatch?.status === 'applied';
  const rolledBack = preview?.rolledBack || selectedBatch?.status === 'rolled-back';
  const stale = !!preview && (!previewReady || preview.sourceRevision !== state?.revision);
  const canApply = !!selected && !!preview && !stale && !alreadyApplied && !rolledBack;
  const apply = async () => {
    if (!selected || !preview || !canApply || !begin('apply')) return;
    setConfirmation(null);
    try {
      await act('local.content.apply', { json: selected.json, sourceRevision: preview.sourceRevision, digest: preview.digest });
      setNotice('内容包已应用到本机题库。已有试卷、草稿、作答和评定历史保持原样。');
    } catch (cause) { setFailure(errorMessage(cause)); }
    finally { setPreviewReady(false); finish(); }
  };
  const rollback = async (batch: ContentBatch) => {
    const reason = reasons[batch.id]?.trim();
    if (!state || !reason || confirmation?.batchId !== batch.id || confirmation.revision !== state.revision || latestApplied?.id !== batch.id || !begin('rollback')) return;
    try {
      await act('local.content.rollback', { batchId: batch.id, sourceRevision: confirmation.revision, reason });
      setNotice('本批次已回退，原因已记录。已有试卷和学习历史保留；同一内容包不会被再次启用。');
    } catch (cause) { setFailure(errorMessage(cause)); }
    finally { setConfirmation(null); setPreviewReady(false); finish(); }
  };

  if (!state) return <Screen title="题库内容包" onBack={back}><LoadingPanel error={failure || error} retry={() => { void refresh(); }} /></Screen>;
  const catalog = state.content?.catalog || [];
  return <Screen title="题库内容包" onBack={back}>
    <View><Text style={styles.eyebrow}>本机试用 · 题库维护</Text><Text style={styles.title}>先核对，{ '\n' }再更新题库。</Text><Text style={styles.subtitle}>导入四年级数学内容包，让后续练习使用更新后的题库。已有学习记录保留。</Text></View>
    <Notice text="当前仅支持本地、未签名的试用内容包。文件摘要用于核对内容是否一致，不证明发布者或教师身份，也不证明题目正确或教学有效。请先确认文件来源。" />
    <Card style={ls.section}><Badge>仅在这台手机处理</Badge><Text style={styles.sectionTitle}>选择内容包</Text><Text style={styles.body}>选择教研端导出的 .json 文件（不超过 500 KB）。先预览影响，再明确应用，不会自动更新题库。</Text>{selected && <Text selectable style={ls.label}>已选：{selected.name}</Text>}<Button label={working === 'pick' ? '正在选择文件…' : working === 'preview' ? '正在检查内容包…' : selected ? '重新选择内容包' : '选择本机内容包'} disabled={locked} onPress={() => { void selectFile(); }} />{selected && <Button label={working === 'reload' ? '正在重读…' : '重读并重新预览此文件'} secondary disabled={locked} onPress={() => { void refresh(); }} />}<Text style={styles.caption}>这里只显示数量、知识点和版本摘要，不展示题干或答案。尚未应用的文件选择仅保留在当前页面。</Text></Card>
    {!!(failure || error) && <View style={ls.section}><Notice text={failure || error!} error /><Text style={styles.caption}>本次失败不会清空已选文件或回退原因。若保存结果不明确，先重读本机记录再继续。</Text><Button label={working === 'reload' ? '正在重读…' : selected ? '保留输入，重读并重新预览' : '保留输入，重读本机记录'} secondary disabled={locked} onPress={() => { void refresh(); }} /></View>}
    {!!notice && <Notice text={notice} />}
    {preview && <Card style={ls.section}><Badge>内容包预览</Badge><Text style={styles.sectionTitle}>这次会改变什么</Text><View style={ls.wrap}>{[[preview.counts.added, '新增'], [preview.counts.updated, '更新'], [preview.counts.withdrawn, '停用'], [preview.counts.unchanged, '保持不变']].map(([value, label]) => <Badge key={label}>{`${label} ${value} 题`}</Badge>)}</View><Text style={styles.caption}>停用只影响之后的选题。已经生成的试卷和原始作答不会被替换。</Text>
      {preview.warnings.map((warning, index) => <Notice key={`${index}-${warning}`} text={warning} />)}
      {rolledBack ? <Notice text="这份内容包已经回退，不能重复应用来重新启用。需要教研端发布一个明确的新版本内容包。" /> : alreadyApplied ? <Notice text="这份内容包已经应用，无需重复导入。可在下方查看原来的应用记录。" /> : stale ? <Notice text="本机记录已变化，或上一次操作需要重新核对。请重新读取并预览后再应用。" /> : <Text style={styles.body}>核对数量和来源后，点击下方按钮应用到本机题库。</Text>}
      <Button label={details ? '收起内容编号与版本摘要' : '查看内容编号与版本摘要'} secondary disabled={locked} onPress={() => setDetails(value => !value)} />
      {details && <View style={ls.section}><Text selectable style={styles.caption}>内容包编号：{preview.packageId}</Text><Text selectable style={styles.caption}>来源自填标识：{preview.publisherId}</Text><Text style={styles.caption}>包内标记时间：{fullDateTime(preview.createdAt)}</Text><Text selectable style={styles.caption}>内容摘要：{preview.digest}</Text>{preview.changes.map(change => <View key={`${change.questionId}-${change.action}`} style={ls.section}><View style={ls.rule} /><Text style={ls.label}>{actionNames[change.action]} · {knowledgeNames[change.knowledgeId]} · {change.taskType ? taskNames[change.taskType] : '任务类型未标注'}</Text><Text selectable style={styles.caption}>题目编号：{change.questionId}{'\n'}题族编号：{change.familyId}</Text><Text style={styles.caption}>{change.previousVersion === undefined ? `版本 ${change.version}` : `版本 ${change.previousVersion} → ${change.version}`} · {change.status === 'published' ? '可供新练习选用' : '停止新选题'}</Text></View>)}</View>}
      <Button label={working === 'apply' ? '正在应用…' : '确认应用到本机题库'} disabled={locked || !canApply} onPress={() => { void apply(); }} />
    </Card>}
    <View style={ls.section}><Text style={styles.sectionTitle}>本机题库与应用记录</Text><Text style={styles.body}>{catalog.filter(item => item.status === 'published').length} 道可用题目 · {catalog.filter(item => item.status === 'disabled').length} 道已停用题目</Text><Text style={styles.caption}>按实际应用顺序展示，最近一次在上方。只能逐次回退最后一个仍生效的批次；回退保留已有草稿、报告和历史记录。</Text></View>
    {[...batches].reverse().map((batch, index) => {
      const current = latestApplied?.id === batch.id;
      const reason = reasons[batch.id] || '';
      const restores = batch.changes.filter(change => change.before !== null).length;
      const removes = batch.changes.length - restores;
      const confirmed = confirmation?.batchId === batch.id && confirmation.revision === state.revision;
      return <Card key={batch.id} style={ls.section}><Badge>{batch.status === 'rolled-back' ? '已回退' : current ? '最近生效批次' : '已应用'}</Badge><Text style={styles.sectionTitle}>第 {batches.length - index} 次应用 · {batch.changes.length} 道内容</Text><Text style={styles.body}>{fullDateTime(batch.appliedAt)}</Text>{batch.status === 'rolled-back' && <><Text style={styles.caption}>回退于 {fullDateTime(batch.rolledBackAt)}</Text><Text style={styles.body}>原因：{batch.reason || '未记录'}</Text></>}
        <Button label={expandedBatch === batch.id ? '收起批次编号' : '查看批次编号'} secondary disabled={locked} onPress={() => setExpandedBatch(expandedBatch === batch.id ? null : batch.id)} />{expandedBatch === batch.id && <View style={ls.section}><Text selectable style={styles.caption}>批次编号：{batch.id}{'\n'}内容包编号：{batch.packageId}{'\n'}来源自填标识：{batch.publisherId}</Text><Text selectable style={styles.caption}>内容摘要：{batch.digest}</Text></View>}
        {current && rollbackId !== batch.id && <Button label="准备回退这一批次" secondary disabled={locked} onPress={() => { setRollbackId(batch.id); setConfirmation(null); }} />}
        {rollbackId === batch.id && <View style={ls.section}><View style={ls.rule} /><Text style={ls.label}>回退影响：恢复 {restores} 道原有内容，移出 {removes} 道本批新增内容</Text><Text style={styles.caption}>移出仅指不再参与新选题。已有试卷快照和作答记录保持原样。</Text><Text style={ls.label}>回退原因（必填）</Text><TextInput accessibilityLabel="内容包回退原因" style={[ls.input, ls.textArea]} value={reason} onChangeText={value => { setReasons(previous => ({ ...previous, [batch.id]: value })); setConfirmation(null); }} editable={!locked && batch.status === 'applied'} multiline maxLength={500} placeholder="例如：发现部分题目需要重新核对" />
          {batch.status === 'rolled-back' ? <Text style={styles.caption}>这次回退已完成。页面中的输入保留供核对。</Text> : !current ? <Notice text="题库记录已变化，这一批已不是最后一个仍生效批次，暂时不能回退。已填写的原因保留。" /> : <><Button label="核对以上回退影响" secondary disabled={locked || !reason.trim()} onPress={() => setConfirmation({ batchId: batch.id, revision: state.revision })} />{confirmed && <Notice text={`即将回退本批 ${batch.changes.length} 道内容，并保存上方原因。请确认后再执行。`} />}{confirmation?.batchId === batch.id && !confirmed && <Notice text="本机记录已变化，请重读记录后重新核对回退影响。原因仍保留。" />}<Button label={working === 'rollback' ? '正在回退…' : `确认回退本批 ${batch.changes.length} 道内容`} disabled={locked || !reason.trim() || !confirmed} onPress={() => { void rollback(batch); }} /></>}
        </View>}
      </Card>;
    })}
    {!batches.length && <Card style={ls.section}><Text style={styles.sectionTitle}>还没有应用过内容包</Text><Text style={styles.body}>内置样题可以继续使用。导入并确认应用后，这里会留下真实记录。</Text></Card>}
    <Button label={working === 'reload' ? '正在重读…' : '刷新本机题库记录'} secondary disabled={locked} onPress={() => { void refresh(); }} />
  </Screen>;
}
