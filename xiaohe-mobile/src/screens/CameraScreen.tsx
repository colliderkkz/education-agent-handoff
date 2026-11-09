import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Image, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as Linking from 'expo-linking';
import { router } from 'expo-router';
import { Screen } from '../components/Screen';
import { companionQuestionLink } from '../components/learning/companionLink';
import { Icon } from '../components/Icon';
import { Badge, Button, Card, InfoNote } from '../components/ui';
import { useLearning } from '../context/LearningContext';
import { listRecoverableLocalPhotos, localPhotoUri, prepareLocalPhoto, type PreparedPhoto } from '../features/local-photo';
import { photoRegistrationPayload } from '../features/photo-recovery';
import { blockedPhotoIds, ownedPhotoName } from '../features/photo-cleanup';
import { colors, styles } from '../theme';

export default function CameraScreen() {
  const { state, loading, error, busy, act, reload } = useLearning();
  const [staged, setStaged] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [prepared, setPrepared] = useState<PreparedPhoto | null>(null);
  const [selectedUploadId, setSelectedUploadId] = useState('');
  const [picking, setPicking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [recovering, setRecovering] = useState(Platform.OS === 'android');
  const [recoverablePhotos, setRecoverablePhotos] = useState<PreparedPhoto[]>([]);
  const [scanError, setScanError] = useState('');
  const [scanRevision, setScanRevision] = useState(0);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [notice, setNotice] = useState('');
  const [failure, setFailure] = useState('');
  const [imageFailed, setImageFailed] = useState(false);
  const [query, setQuery] = useState('');
  const [matchIds, setMatchIds] = useState<string[] | null>(null);
  const [selectedQuestionId, setSelectedQuestionId] = useState('');
  const [confirmedId, setConfirmedId] = useState('');
  const [originalAnswer, setOriginalAnswer] = useState('');
  const [reportId, setReportId] = useState('');
  const [removedPhoto, setRemovedPhoto] = useState(false);
  const nativeOperation = useRef(false);
  const deletedPhotoIds = useMemo(() => blockedPhotoIds((state?.historyDeletion?.fileTasks || []).map(item => ({ uploadId: item.uploadId, url: item.uploadUrl }))), [state?.historyDeletion?.fileTasks]);
  const deletedPhotos = useMemo(() => new Set(deletedPhotoIds), [deletedPhotoIds]);
  const deletedPhotosRef = useRef(new Set<string>());
  const selectedUpload = state?.uploads.find(item => item.id === selectedUploadId);
  const selectedQuestion = state?.questions.find(item => item.id === selectedQuestionId);
  const confirmedQuestion = state?.questions.find(item => item.id === confirmedId);
  const preparedDeleted = !!prepared && (deletedPhotos.has(prepared.id) || deletedPhotos.has(ownedPhotoName(prepared.uri)?.slice(0, 36) || ''));
  const stagedDeleted = !!staged && deletedPhotos.has(ownedPhotoName(staged.uri)?.slice(0, 36) || '');
  const previewUri = (!preparedDeleted && prepared?.uri) || (!stagedDeleted && staged?.uri) || selectedUpload?.url;
  const savedReportId = reportId || (selectedUpload?.status === 'confirmed' ? state?.papers.find(paper => paper.reason.includes(selectedUpload.id))?.id : undefined);
  const disabled = busy || loading || picking || saving || submitting || recovering || reloading || !state;
  const uploads = state?.uploads;
  const otherRecoverablePhotos = recoverablePhotos.filter(photo => !deletedPhotos.has(photo.id) && !deletedPhotos.has(ownedPhotoName(photo.uri)?.slice(0, 36) || '') && photo.id !== prepared?.id && !uploads?.some(upload => upload.id === photo.id));

  useEffect(() => {
    deletedPhotosRef.current = deletedPhotos;
    let active = true;
    if (preparedDeleted || stagedDeleted || deletedPhotos.has(selectedUploadId)) void Promise.resolve().then(() => {
      if (!active) return;
      if (preparedDeleted) setPrepared(null);
      if (stagedDeleted) setStaged(null);
      if (deletedPhotos.has(selectedUploadId)) setSelectedUploadId('');
      setConfirmedId(''); setSelectedQuestionId(''); setMatchIds(null); setReportId(''); setImageFailed(false); setRemovedPhoto(true);
      setNotice('这张应用内照片已在历史管理中删除，不再预览或恢复。未保存的手工文字仅留在本页。');
    });
    return () => { active = false; };
  }, [deletedPhotos, preparedDeleted, stagedDeleted, selectedUploadId]);

  useEffect(() => {
    if (!uploads || loading || saving) return;
    let active = true;
    listRecoverableLocalPhotos(uploads, deletedPhotoIds).then(photos => {
      if (active) { setRecoverablePhotos(photos); setScanError(''); }
    }).catch(() => { if (active) setScanError('暂时无法检查上次未完成保存的照片。已有照片不会被删除，可以稍后再检查。'); });
    return () => { active = false; };
  }, [uploads, loading, saving, scanRevision, deletedPhotoIds]);

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    let active = true;
    ImagePicker.getPendingResultAsync().then(result => {
      if (!active || !result) return;
      if ('code' in result) { setFailure('刚才选择的图片没有恢复成功，可以重新从相册选择。'); return; }
      if (!result.canceled && result.assets[0]) { setStaged(result.assets[0]); setNotice('找回了刚才选择的图片。确认后保存到本机即可继续。'); }
    }).catch(() => { if (active) setFailure('暂时无法恢复上次拍照，你可以重新拍摄或从相册选择。'); }).finally(() => { if (active) setRecovering(false); });
    return () => { active = false; };
  }, []);

  function clearMatching() { setMatchIds(null); setSelectedQuestionId(''); setConfirmedId(''); setOriginalAnswer(''); setReportId(''); }

  async function reloadRecords() {
    if (nativeOperation.current || busy || loading || picking || saving || submitting || recovering || reloading) return;
    nativeOperation.current = true; setReloading(true); setNotice('');
    try {
      await reload();
      setFailure(''); setScanRevision(value => value + 1);
      setNotice(prepared ? '本机记录已重新读取。当前图片和输入都保留着，可以重试保存当前图片。' : '本机记录已重新读取，当前图片和输入都保留着。');
    } catch (cause) { setFailure(cause instanceof Error ? cause.message : '暂时无法重新读取。当前图片和输入会保留，请稍后重试。'); }
    finally { nativeOperation.current = false; setReloading(false); }
  }

  async function pick(source: 'camera' | 'library') {
    if (nativeOperation.current || disabled || prepared) return;
    nativeOperation.current = true; setPicking(true); setFailure(''); setNotice('');
    try {
      if (source === 'camera') {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) {
          setPermissionDenied(true);
          setFailure(permission.canAskAgain ? '还没有获得相机权限。你可以再次拍照时允许，或从相册选择图片。' : '相机权限已关闭。可以在系统设置里允许相机，也可以从相册选择。');
          return;
        }
        setPermissionDenied(false);
      }
      const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], allowsEditing: false, quality: .85, exif: false, base64: false, allowsMultipleSelection: false };
      // The system photo picker grants access only to the selected image; no broad library permission is requested.
      const result = source === 'camera' ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
      if (result.canceled) { setNotice('已取消，之前的图片和记录都保留着。'); return; }
      if (!result.assets[0]) throw new Error('没有取得图片，请再选择一次。');
      setStaged(result.assets[0]); setSelectedUploadId(''); setImageFailed(false); setQuery(''); clearMatching();
      setNotice('图片已选好。先确认清楚完整，再保存到本机。');
    } catch (cause) { setFailure(cause instanceof Error ? `没有打开或取得图片：${cause.message}` : '暂时无法打开相机或相册，请在手机上重试。'); }
    finally { nativeOperation.current = false; setPicking(false); }
  }

  async function savePhoto() {
    if ((!staged && !prepared) || disabled || nativeOperation.current) return;
    nativeOperation.current = true;
    setSaving(true); setFailure(''); setNotice('');
    try {
      const photo = prepared || await prepareLocalPhoto(staged!);
      if (deletedPhotosRef.current.has(photo.id) || deletedPhotosRef.current.has(ownedPhotoName(photo.uri)?.slice(0, 36) || '')) throw new Error('这张本机照片已经删除，不能恢复登记。');
      setPrepared(photo);
      // Reuse the same ID on retry. A persistence error must never delete a possibly committed image.
      const payload = photoRegistrationPayload(photo, state?.uploads || [], localPhotoUri);
      const result = await act('local.upload', { ...payload, purpose: 'single' });
      setSelectedUploadId(typeof result.result?.id === 'string' ? result.result.id : photo.id);
      setStaged(null); setPrepared(null); setImageFailed(false);
      setNotice('图片已保存在这台手机。可以识别文字并逐题核对，也可以继续手工输入题目。');
    } catch (cause) { setFailure(`${cause instanceof Error ? cause.message : '图片暂时没有保存完成。'} 已取得的图片会保留，可以重试保存。`); }
    finally { nativeOperation.current = false; setSaving(false); }
  }

  async function searchQuestions() {
    if (!query.trim() || disabled) return;
    setFailure(''); setNotice(''); setSelectedQuestionId(''); setConfirmedId(''); setReportId('');
    try {
      const result = await act('single.match', { text: query.trim() });
      const ids = result.result?.questionIds;
      setMatchIds(Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : []);
    } catch (cause) { setFailure(cause instanceof Error ? cause.message : '没有找到匹配结果，请核对文字后再试。'); }
  }

  async function help(level: 'hint' | 'explanation') {
    if (!confirmedQuestion || disabled || nativeOperation.current) return;
    nativeOperation.current = true; setSubmitting(true); setFailure(''); setNotice('');
    try {
      if (level === 'hint') {
        const opened = await act('chat.open', { context: { source: 'bank', questionId: confirmedQuestion.id, questionVersion: confirmedQuestion.version } });
        const threadId = opened.result?.id;
        if (!threadId) throw new Error('暂时无法确认题目上下文，请重读后再试。');
        await act('chat.send', { threadId, text: '', intent: 'hint', requestId: `camera-hint:${threadId}` });
      }
      else await act('single.explain', { id: confirmedQuestion.id });
      setNotice(level === 'hint' ? '提示已打开，也记下了这次帮助。' : '讲解已打开，这次学习会保留讲解使用记录。');
    } catch (cause) { setFailure(cause instanceof Error ? cause.message : '暂时没有打开帮助，请重试。'); }
    finally { nativeOperation.current = false; setSubmitting(false); }
  }

  async function saveOriginal() {
    if (!selectedUpload || !confirmedQuestion || !originalAnswer.trim() || disabled || nativeOperation.current) return;
    nativeOperation.current = true; setSubmitting(true); setFailure(''); setNotice('');
    try {
      const result = await act('homework.confirm', { uploadId: selectedUpload.id, entries: [{ questionId: confirmedQuestion.id, answer: originalAnswer.trim(), working: '本人对照本机图片，手工核对题目与纸上原始答案。' }] });
      if (typeof result.result?.id === 'string') setReportId(result.result.id);
      setOriginalAnswer('');
      setNotice('纸上原始答案已保存。订正与原始记录分开，也不会把纸面记录当作独立新题加星。');
    } catch (cause) { setFailure(cause instanceof Error ? cause.message : '原始答案没有保存完成，请稍后重试。'); }
    finally { nativeOperation.current = false; setSubmitting(false); }
  }

  if (loading && !state) return <Screen><Card style={{ gap: 15, alignItems: 'center' }}><ActivityIndicator color={colors.primary} /><Text style={styles.body}>正在打开本机拍题记录…</Text></Card></Screen>;
  if (!state) return <Screen><Text style={styles.title}>拍题与核对</Text><Card style={{ gap: 16 }}><Text style={styles.body}>{failure || error || '暂时没有打开本机记录。'}</Text><Button label={reloading ? '正在重新读取…' : '重新读取本机记录'} disabled={busy || loading || reloading || recovering} onPress={() => { void reloadRecords(); }} /></Card></Screen>;

  return <Screen>
    <View><Text style={styles.eyebrow}>从眼前的题目出发</Text><Text style={styles.title}>拍下问题，{ '\n' }一起想明白。</Text><Text style={styles.subtitle}>照片留在本机，对照题干，一步步找到思路。</Text></View>
    <Card style={{ gap: 15 }}><View style={styles.row}><Badge>本机拍题</Badge><Text style={[styles.caption, { flex: 1, textAlign: 'right' }]}>{staged || prepared ? '选好后保存' : selectedUpload ? '图片已保存' : '一次拍清一道题'}</Text></View>
      {previewUri ? <View style={{ gap: 10 }}><Image accessibilityLabel="当前选择的题目原图" source={{ uri: localPhotoUri(previewUri) }} style={s.preview} resizeMode="contain" onError={() => setImageFailed(true)} onLoad={() => setImageFailed(false)} />{imageFailed ? <Text style={s.error}>图片暂时无法显示。记录仍保留，可以重新选择原图。</Text> : null}<Text style={styles.caption}>{prepared?.name || staged?.fileName || selectedUpload?.name || '刚刚拍下的题目'}</Text></View> : <View style={s.frame}><View style={[s.corner, s.topLeft]} /><View style={[s.corner, s.topRight]} /><View style={[s.corner, s.bottomLeft]} /><View style={[s.corner, s.bottomRight]} /><Icon name="camera" size={49} /><Text style={s.frameText}>让题目完整、清楚地出现在画面里</Text></View>}
      {(staged || prepared) ? <><Button label={saving ? '正在保存到本机…' : prepared ? '重试保存当前图片' : '确认图片，保存到本机'} icon="check" disabled={disabled} onPress={() => { void savePhoto(); }} />{!prepared && <Button label="暂不保存这张" secondary disabled={disabled} onPress={() => { setStaged(null); setNotice('已取消这张图片，原相册和已保存的记录都没有改变。'); }} />}</> : null}
      <View style={{ gap: 10 }}><Button label={picking ? '正在打开…' : '拍照'} icon="camera" disabled={disabled || Boolean(prepared)} onPress={() => { void pick('camera'); }} /><Button label="从相册选择" icon="paper" secondary disabled={disabled || Boolean(prepared)} onPress={() => { void pick('library'); }} /></View>
      <Text style={styles.caption}>只保存你主动选择的照片。保存后可在设备上识别文字，再对照原图逐题核对。</Text>
      {selectedUpload && !staged && !prepared && <Button label="识别文字与逐题核对" disabled={disabled} onPress={() => router.push({ pathname: '/photo-review', params: { uploadId: selectedUpload.id } })} />}
    </Card>
    {(failure || error) ? <Card style={{ backgroundColor: '#FFF5EF', borderColor: '#EED8CC', gap: 12 }}><Text accessibilityRole="alert" style={s.error}>{failure || error}</Text><Text style={styles.caption}>重新读取已保存的记录后再试。当前照片、题干和答案输入都会保留。</Text><Button label={reloading ? '正在重新读取…' : '重新读取本机记录'} secondary disabled={disabled} onPress={() => { void reloadRecords(); }} />{permissionDenied && <Button label="打开相机权限设置" secondary disabled={disabled} onPress={() => { void Linking.openSettings().catch(() => setFailure('暂时无法打开设置，请在手机的应用设置中允许小禾使用相机。')); }} />}</Card> : null}
    {notice ? <View style={s.notice}><Icon name="check" size={17} /><Text accessibilityLiveRegion="polite" style={s.noticeText}>{notice}</Text></View> : null}
    {removedPhoto && !!originalAnswer && <Card style={{ gap: 12 }}><Text style={styles.sectionTitle}>尚未保存的页面答案</Text><Text selectable style={styles.body}>{originalAnswer}</Text><Text style={styles.caption}>关联图片已删除，这段未保存文字仅供复制，不会写回旧记录。</Text><Button label="清除这段未保存文字" secondary disabled={disabled} onPress={() => { setOriginalAnswer(''); setRemovedPhoto(false); }} /></Card>}
    {(otherRecoverablePhotos.length > 0 || scanError) && <Card style={{ gap: 13 }}><Text style={styles.sectionTitle}>继续保存上次的照片</Text><Text style={styles.body}>这些照片已留在本机，还没有加入拍题记录。选择一张预览，再确认保存即可继续。</Text>{scanError ? <Text accessibilityRole="alert" style={s.error}>{scanError}</Text> : null}{otherRecoverablePhotos.length > 0 && <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 11 }}>{otherRecoverablePhotos.map(photo => <Pressable key={photo.id} accessibilityRole="button" accessibilityLabel={`恢复照片：${photo.name}`} disabled={disabled || Boolean(prepared) || Boolean(staged)} onPress={() => { setPrepared(photo); setSelectedUploadId(''); setImageFailed(false); setQuery(''); clearMatching(); setFailure(''); setNotice('已找回这张照片。确认预览后，点击“重试保存当前图片”。'); }} style={s.thumbnailCard}><Image source={{ uri: localPhotoUri(photo.uri) }} style={s.thumbnail} resizeMode="cover" /><Text numberOfLines={1} style={s.thumbnailText}>{photo.name}</Text><Text style={s.thumbnailMeta}>点击预览并继续保存</Text></Pressable>)}</ScrollView>}{(prepared || staged) && otherRecoverablePhotos.length > 0 ? <Text style={styles.caption}>先处理上方当前图片，再选择另一张。</Text> : null}<Button label="重新检查未完成的照片" secondary disabled={disabled} onPress={() => setScanRevision(value => value + 1)} /></Card>}
    {state.uploads.length > 0 && <View style={{ gap: 12 }}><Text style={styles.sectionTitle}>已保存的图片</Text><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 11 }}>{state.uploads.map(item => <Pressable key={item.id} disabled={disabled || Boolean(prepared)} accessibilityRole="button" accessibilityLabel={`查看图片：${item.name}`} accessibilityState={{ selected: selectedUploadId === item.id }} onPress={() => { setSelectedUploadId(item.id); setStaged(null); setImageFailed(false); setQuery(''); clearMatching(); setFailure(''); setNotice('已打开本机保存的图片。'); }} style={[s.thumbnailCard, selectedUploadId === item.id && s.selectedThumbnail]}><Image source={{ uri: localPhotoUri(item.url) }} style={s.thumbnail} resizeMode="cover" /><Text numberOfLines={1} style={s.thumbnailText}>{item.name}</Text><Text style={s.thumbnailMeta}>{item.status === 'confirmed' ? '原始答案已记录' : '可以继续核对'}</Text></Pressable>)}</ScrollView></View>}
    <Card style={{ gap: 15 }}><View style={styles.row}><View style={s.step}><Text style={s.stepText}>1</Text></View><Text style={styles.sectionTitle}>手工输入，核对题干</Text></View><Text style={styles.body}>把题目中的数字、单位和问题写完整。也可以不拍照，直接输入题目。</Text><TextInput style={[s.input, s.multiline]} accessibilityLabel="手工输入题目文字" editable={!disabled} value={query} onChangeText={value => { setQuery(value); setMatchIds(null); setSelectedQuestionId(''); setConfirmedId(''); setReportId(''); }} placeholder="例如：图书角新买了168本书，平均分给12个小组，每组分到多少本？" placeholderTextColor="#8B9C81" multiline textAlignVertical="top" maxLength={2000} /><Button label="在本机题库里找一找" icon="book" disabled={disabled || !query.trim()} onPress={() => { void searchQuestions(); }} /><Text style={styles.caption}>这一步按输入文字查找样题，不是图片识别。候选题还需要你逐题核对。</Text></Card>
    {matchIds !== null && <View style={{ gap: 13 }}><Text style={styles.sectionTitle}>先确认，是不是同一道题</Text>{!matchIds.length ? <Card style={{ gap: 12 }}><Text style={s.cardTitle}>这次没有找到合适样题</Text><Text style={styles.body}>照片仍保存在本机。可以检查数字和单位后再找一次；当前不会为题库以外的题目猜答案。</Text></Card> : matchIds.map(id => { const question = state.questions.find(item => item.id === id); if (!question) return null; const selected = selectedQuestionId === id; return <Pressable key={id} disabled={disabled} accessibilityRole="radio" accessibilityState={{ checked: selected, disabled }} accessibilityLabel={`选择候选题：${question.text}`} onPress={() => { setSelectedQuestionId(id); setConfirmedId(''); setOriginalAnswer(''); setReportId(''); }} style={[styles.card, s.candidate, selected && s.selectedCandidate]}><View style={styles.row}><View style={[s.radio, selected && s.radioSelected]}>{selected && <View style={s.radioDot} />}</View><Text style={[s.candidateTitle, { flex: 1 }]}>{question.text}</Text></View><Text style={styles.caption}>{state.knowledge.find(item => item.id === question.knowledgeId)?.name} · {question.difficulty} · 教学样题</Text></Pressable>; })}{selectedQuestion && confirmedId !== selectedQuestion.id && <Card style={{ gap: 13 }}><Text style={styles.body}>请再对照一次：条件、数字、单位，以及最后问的问题都一致吗？</Text><Button label="我已核对，是同一道题" icon="check" disabled={disabled} onPress={() => { setConfirmedId(selectedQuestion.id); setNotice('同题已确认，可以先看提示，也可以记录纸上原始答案。'); }} /></Card>}</View>}
    {confirmedQuestion && <>
      <Card style={{ gap: 16 }}><View style={styles.row}><View style={s.step}><Text style={s.stepText}>2</Text></View><Text style={styles.sectionTitle}>先想一想，再看提示</Text></View><Text style={s.candidateTitle}>{confirmedQuestion.text}</Text>{confirmedQuestion.hint ? <View style={s.hint}><Text style={s.label}>一点提示</Text><Text style={styles.body}>{confirmedQuestion.hint}</Text></View> : <Button label="先给我一点提示" secondary icon="leaf" disabled={disabled} onPress={() => { void help('hint'); }} />}{confirmedQuestion.steps.length ? <><View style={s.answer}><Text style={styles.caption}>参考答案</Text><Text style={s.answerText}>{confirmedQuestion.answer} {confirmedQuestion.unit}</Text></View>{confirmedQuestion.steps.map((step, index) => <View key={`${confirmedQuestion.id}-${index}`} style={[styles.row, { alignItems: 'flex-start' }]}><View style={s.smallStep}><Text style={s.stepText}>{index + 1}</Text></View><Text style={[styles.body, { flex: 1 }]}>{step}</Text></View>)}{confirmedQuestion.alternative ? <View style={s.hint}><Text style={s.label}>换一种思路</Text><Text style={styles.body}>{confirmedQuestion.alternative}</Text></View> : null}<Text style={styles.caption}>讲解来自本机教学样题，帮助使用已记录。</Text></> : <Button label="再看完整讲解" icon="book" disabled={disabled} onPress={() => { void help('explanation'); }} />}</Card>
      <Button label="带这道题问小禾" secondary disabled={disabled} onPress={() => router.push(companionQuestionLink(confirmedQuestion))} />
      {selectedUpload && <Card style={{ gap: 15 }}><View style={styles.row}><View style={s.step}><Text style={s.stepText}>3</Text></View><Text style={styles.sectionTitle}>留下纸上的原始回答</Text></View>{selectedUpload.status === 'confirmed' ? <><Text style={styles.body}>这张图片的原始答案已记录，不会被后来的订正覆盖。</Text>{savedReportId && <Button label="查看这次作业报告" onPress={() => router.push({ pathname: '/report/[id]', params: { id: savedReportId } })} />}</> : <><Text style={styles.body}>请填写照片里原本写的答案，不要填写刚刚看到的参考答案。先保留原作，再慢慢订正。</Text><TextInput style={s.input} accessibilityLabel="纸上原始答案" editable={!disabled} value={originalAnswer} onChangeText={setOriginalAnswer} placeholder="照着纸上原来的答案填写" placeholderTextColor="#8B9C81" maxLength={300} /><Button label={submitting ? '正在保存原始答案…' : '确认原始答案并保存'} icon="check" disabled={disabled || !originalAnswer.trim()} onPress={() => { void saveOriginal(); }} /><Text style={styles.caption}>纸面作答的帮助情况无法核实，这类记录不会增加独立新题星级。</Text></>}</Card>}
    </>}
    <InfoNote text="图片和作答只保存在本机。拍照时避开姓名等个人信息；没有找到同题时，先保留原图，不凭相似题判断对错。" />
  </Screen>;
}

const s = StyleSheet.create({
  frame: { height: 174, width: '100%', alignItems: 'center', justifyContent: 'center', gap: 16, marginVertical: 7, backgroundColor: '#F8FAF4' }, frameText: { fontSize: 11, lineHeight: 19, color: colors.muted }, corner: { position: 'absolute', height: 24, width: 24, borderColor: '#A4BD91' }, topLeft: { top: 0, left: 0, borderTopWidth: 2, borderLeftWidth: 2, borderTopLeftRadius: 10 }, topRight: { top: 0, right: 0, borderTopWidth: 2, borderRightWidth: 2, borderTopRightRadius: 10 }, bottomLeft: { bottom: 0, left: 0, borderBottomWidth: 2, borderLeftWidth: 2, borderBottomLeftRadius: 10 }, bottomRight: { bottom: 0, right: 0, borderBottomWidth: 2, borderRightWidth: 2, borderBottomRightRadius: 10 }, preview: { width: '100%', height: 280, backgroundColor: '#F4F6EF', borderRadius: 12 }, step: { width: 27, height: 27, backgroundColor: colors.primaryLight, borderRadius: 9, alignItems: 'center', justifyContent: 'center' }, stepText: { color: colors.primary, fontSize: 11, fontWeight: '600' }, smallStep: { width: 23, height: 23, backgroundColor: colors.primaryLight, borderRadius: 8, alignItems: 'center', justifyContent: 'center', marginTop: 1 }, input: { borderWidth: 1, borderColor: '#D9E6D3', borderRadius: 12, padding: 14, backgroundColor: '#FBFDF8', fontSize: 14, lineHeight: 24, color: colors.ink, minHeight: 49 }, multiline: { minHeight: 130 }, notice: { flexDirection: 'row', gap: 10, paddingHorizontal: 4, alignItems: 'flex-start' }, noticeText: { flex: 1, color: colors.primary, fontSize: 12, lineHeight: 21 }, error: { color: colors.error, fontSize: 12, lineHeight: 22 }, thumbnailCard: { width: 110, borderWidth: 1, borderColor: colors.border, padding: 6, borderRadius: 12, backgroundColor: '#FFFFFF', gap: 5 }, selectedThumbnail: { borderColor: colors.primary, backgroundColor: '#F0F7EB' }, thumbnail: { width: 96, height: 83, borderRadius: 7, backgroundColor: '#EDF2E7' }, thumbnailText: { fontSize: 10, color: colors.ink, marginTop: 2 }, thumbnailMeta: { fontSize: 9, color: colors.muted, paddingBottom: 3 }, candidate: { gap: 12, padding: 17 }, selectedCandidate: { borderColor: '#80A96C', backgroundColor: '#F4F9EE' }, candidateTitle: { color: colors.ink, fontSize: 14, lineHeight: 25, fontWeight: '500' }, radio: { width: 19, height: 19, borderWidth: 1.5, borderColor: '#B9C9AE', borderRadius: 10, alignItems: 'center', justifyContent: 'center' }, radioSelected: { borderColor: colors.primary }, radioDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: colors.primary }, cardTitle: { fontSize: 16, lineHeight: 25, fontWeight: '600', color: colors.ink }, hint: { backgroundColor: '#F2F7E9', borderRadius: 12, padding: 16, gap: 8 }, label: { fontSize: 12, color: colors.primary, fontWeight: '600', lineHeight: 20 }, answer: { flexDirection: 'row', alignItems: 'center', gap: 15, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 17 }, answerText: { fontSize: 22, color: colors.primary, fontWeight: '600', flex: 1, lineHeight: 30 },
});
