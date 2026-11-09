import { useEffect, useRef, useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { router, useLocalSearchParams, usePreventRemove } from 'expo-router';
import { Screen } from '../components/Screen';
import { Badge, Button, Card } from '../components/ui';
import { Chip, dateLabel, errorMessage, learningStyles as ls, LoadingPanel, Notice } from '../components/learning/LearnUI';
import { useLearning } from '../context/LearningContext';
import { exportPaper } from '../features/paper-export-flow';
import { listPaperPdfs, previewPaperPdf, printPaperPdf, renderPaperPdfs, sharePaperPdf, type ExportedPaperFile, type PaperExportBatch } from '../features/local-paper-export';
import type { PaperPrintMode } from '../features/paper-print-template';
import { styles } from '../theme';

export default function PaperExportScreen() {
  const { paperId } = useLocalSearchParams<{ paperId: string }>();
  return <PaperExportContent key={paperId} paperId={paperId} />;
}
function PaperExportContent({ paperId }: { paperId: string }) {
  const { state, error: loadError, reload, act, busy } = useLearning();
  const paper = state?.papers.find(item => item.id === paperId);
  const [mode, setMode] = useState<PaperPrintMode>('student');
  const [batches, setBatches] = useState<PaperExportBatch[]>([]);
  const [operation, setOperation] = useState('');
  const operationRef = useRef(false);
  const scanRevision = useRef(0);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  usePreventRemove(!!operation, () => Alert.alert('正在准备本机文件', '请稍等这次操作完成后再返回。'));
  const back = () => router.canGoBack() ? router.back() : router.replace('/practice');
  const id = paper?.id;
  const version = paper?.version;
  useEffect(() => {
    let active = true;
    const revision = ++scanRevision.current;
    if (id && version) void listPaperPdfs(id, version).then(items => { if (active && scanRevision.current === revision) setBatches(items); }).catch(() => { if (active && scanRevision.current === revision) setError('暂时无法读取之前的导出文件，可以重试生成。原卷没有变化。'); });
    return () => { active = false; };
  }, [id, version]);
  if (!state) return <Screen title="导出与打印" onBack={back}><LoadingPanel error={loadError} retry={() => { void reload().catch(() => {}); }} /></Screen>;
  if (!paper) return <Screen title="导出与打印" onBack={back}><Notice text="未找到这份练习，请返回列表重新打开。" /></Screen>;
  const disabled = !!operation || busy;
  const currentBatches = batches.filter(batch => batch.paperId === paper.id && batch.paperVersion === paper.version);
  const generate = async (selected: PaperPrintMode) => {
    if (operationRef.current || busy) return;
    operationRef.current = true; setOperation('正在生成 PDF…'); setError(''); setNotice('');
    ++scanRevision.current;
    try {
      const result = await exportPaper(paper, selected, { act, render: renderPaperPdfs });
      const existing = await listPaperPdfs(paper.id, paper.version).catch(() => []);
      setBatches(previous => [result, ...existing, ...previous].filter((item, index, all) => all.findIndex(other => other.id === item.id) === index));
      setNotice(`已生成 ${result.files.length} 份独立 PDF，保存在本机。可以分别预览、打印或选择保存与分享。`);
    } catch (cause) {
      setError(`${errorMessage(cause)} 原卷与已有文件仍保留，可重试生成。若已记录解析查看，重试不会撤销该记录。`);
    } finally { operationRef.current = false; setOperation(''); }
  };
  const reread = async () => {
    if (operationRef.current) return;
    operationRef.current = true; setOperation('正在重新读取…'); setError('');
    ++scanRevision.current;
    try {
      await reload();
      const items = await listPaperPdfs(paper.id, paper.version);
      setBatches(items); setNotice('本机记录与已生成文件已重新读取，可以重试。导出选择仍保留。');
    } catch (cause) { setError(errorMessage(cause)); }
    finally { operationRef.current = false; setOperation(''); }
  };
  const confirmGenerate = () => {
    if (mode === 'student') { void generate(mode); return; }
    Alert.alert('准备答案解析卷', '生成解析卷前会记录本卷答案已可查看，并同步对应题目的未完成练习；已提交的原始作答与成绩不变。', [
      { text: '先不生成', style: 'cancel' }, { text: '记录并生成', onPress: () => { void generate(mode); } },
    ]);
  };
  const openFile = async (kind: 'preview' | 'print' | 'share', batch: PaperExportBatch, file: ExportedPaperFile) => {
    if (operationRef.current) return;
    operationRef.current = true; setOperation('正在打开系统面板…'); setError(''); setNotice('');
    try {
      if (kind === 'preview') {
        const viewer = await previewPaperPdf(batch, file);
        setNotice(viewer === 'print' ? '已打开系统打印预览，可选择保存为 PDF，也可以返回。' : '已交给系统 PDF 查看器；关闭后可回到这份练习。');
      } else if (kind === 'print') {
        await printPaperPdf(batch, file); setNotice('已打开系统打印面板。是否保存或打印，以你在系统面板中的选择为准。');
      } else {
        await sharePaperPdf(batch, file); setNotice('已返回 App，PDF 仍保存在本机；是否分享或保存，以你在系统面板中的选择为准。');
      }
    } catch (cause) { setError(`${errorMessage(cause)} 原卷与作答记录仍保留，可以重新生成或再次打开。`); }
    finally { operationRef.current = false; setOperation(''); }
  };
  return <Screen title="导出与打印" onBack={back}>
    <View><Text style={styles.eyebrow}>A4 纸张 · 本机生成</Text><Text style={styles.title}>{paper.title}</Text><Text style={styles.subtitle}>{paper.questions.length} 题 · 第 {paper.version} 版</Text></View>
    <Notice text="导出使用这份练习已保存的题目和顺序。学生卷与答案解析卷分别保存，不会把答案附在学生卷后面。" />
    <Card style={ls.section}><Text style={styles.sectionTitle}>准备哪一种文件</Text><View style={ls.wrap}>
      {([['student', '学生卷'], ['solutions', '答案解析卷'], ['both', '两份一起']] as const).map(([value, label]) => <Chip key={value} text={label} selected={mode === value} disabled={disabled} onPress={() => setMode(value)} />)}
    </View><Text style={styles.body}>学生卷保留题干、来源和作答空间。解析卷包含答案、解题步骤与核验提示。姓名和班级留空，可按需要手写。系统打印时请选择 A4 纸张。</Text><Button label={operation || '生成所选 PDF'} disabled={disabled} onPress={confirmGenerate} /></Card>
    {!!error && <View style={ls.section}><Notice text={error} error /><Button label="重新读取本机记录与文件" secondary disabled={disabled} onPress={() => { void reread(); }} /></View>}{!!notice && <Notice text={notice} />}
    {currentBatches.length > 0 && <Text style={styles.sectionTitle}>这份练习的本机文件</Text>}
    {currentBatches.map(batch => <Card key={batch.id} style={ls.section}><Text style={styles.caption}>{dateLabel(batch.createdAt)} · 第 {batch.paperVersion} 版 · {batch.files.length} 份独立文件</Text>{batch.files.map(file => <View key={file.kind} style={ls.section}><Badge>{file.kind === 'student' ? '学生卷 · 不含答案' : '答案解析卷'}</Badge><Text style={styles.body}>A4 · 页数以 PDF 预览为准</Text><Text style={styles.caption}>{file.name}</Text><Button label={file.kind === 'student' ? '预览学生卷 PDF' : '预览解析卷 PDF'} secondary disabled={disabled} onPress={() => { void openFile('preview', batch, file); }} /><Button label={file.kind === 'student' ? '打印学生卷' : '打印解析卷'} secondary disabled={disabled} onPress={() => { void openFile('print', batch, file); }} /><Button label={file.kind === 'student' ? '保存或分享学生卷' : '保存或分享解析卷'} secondary disabled={disabled} onPress={() => { void openFile('share', batch, file); }} /></View>)}</Card>)}
    {paper.status !== 'completed' && <Button label="拍照回传这份纸面练习" disabled={disabled} onPress={() => router.push({ pathname: '/paper-return/[paperId]', params: { paperId: paper.id } })} />}
    <Text style={styles.caption}>文件只保存在本机。系统预览、打印和分享由你操作；当前不会自动发给老师或上传云端。</Text>
  </Screen>;
}
