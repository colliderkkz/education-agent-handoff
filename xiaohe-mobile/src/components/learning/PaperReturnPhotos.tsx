import { useEffect, useRef, useState } from 'react';
import { Alert, Image, Platform, ScrollView, Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as Linking from 'expo-linking';
import { useLearning } from '../../context/LearningContext';
import { listRecoverableLocalPhotos, localPhotoUri, prepareLocalPhoto, type PreparedPhoto } from '../../features/local-photo';
import { photoRegistrationPayload } from '../../features/photo-recovery';
import { blockedPhotoIds } from '../../features/photo-cleanup';
import { createPendingPhotoRecovery } from '../../features/paper-photo-pending';
import { styles } from '../../theme';
import { Button, Card } from '../ui';
import { errorMessage, learningStyles as ls, Notice } from './LearnUI';

const pendingPhotoRecovery = createPendingPhotoRecovery<ImagePicker.ImagePickerResult | ImagePicker.ImagePickerErrorResult>();

export function PaperReturnPhotos({ paperId, selectedIds, disabled, beforePick, onChange, onBusy, onPending }: { paperId: string; selectedIds: string[]; disabled: boolean; beforePick: () => Promise<unknown>; onChange: (id: string, add: boolean) => Promise<void>; onBusy: (busy: boolean) => void; onPending: (pending: boolean) => void }) {
  const { state, act } = useLearning();
  const [error, setError] = useState(''), [permissionDenied, setPermissionDenied] = useState(false);
  const [pending, setPending] = useState<PreparedPhoto | null>(null);
  const [recovered, setRecovered] = useState<PreparedPhoto[]>([]);
  const [pendingAssets, setPendingAssets] = useState<ImagePicker.ImagePickerAsset[]>([]);
  const [working, setWorking] = useState(false), [notice, setNotice] = useState('');
  const [restoring, setRestoring] = useState(Platform.OS === 'android');
  const operation = useRef(false);
  const uploads = state?.uploads;
  const deletionTasks = state?.historyDeletion?.fileTasks;
  const deletedIds = blockedPhotoIds((deletionTasks || []).map(task => ({ uploadId: task.uploadId, url: task.uploadUrl })));
  // Discard a saved photo immediately when authoritative deletion changes.
  // The guarded adjustment settles before any children can display stale images.
  if (pending && deletedIds.includes(pending.id)) setPending(null);
  if (recovered.some(photo => deletedIds.includes(photo.id))) setRecovered(recovered.filter(photo => !deletedIds.includes(photo.id)));
  const selected = selectedIds.map(id => uploads?.find(item => item.id === id)).filter(item => item !== undefined);
  const boundIds = new Set(state?.paperReturns?.filter(item => item.paperId !== paperId).flatMap(item => item.uploadIds));
  const available = (uploads || []).filter(item => item.purpose === 'homework' && item.status === 'pending' && !selectedIds.includes(item.id) && !boundIds.has(item.id));
  useEffect(() => { onPending(!!pending || pendingAssets.length > 0); }, [pending, pendingAssets, onPending]);
  useEffect(() => {
    let active = true;
    const removed = blockedPhotoIds((deletionTasks || []).map(task => ({ uploadId: task.uploadId, url: task.uploadUrl })));
    if (uploads && !working) void listRecoverableLocalPhotos(uploads, removed).then(items => { if (active) setRecovered(items); }).catch(() => { if (active) setError('未能检查待恢复的本机图片。已有图片保留着，可重读后再试。'); });
    return () => { active = false; };
  }, [uploads, working, deletionTasks]);
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    let active = true;
    onBusy(true);
    void pendingPhotoRecovery.read(() => ImagePicker.getPendingResultAsync()).then(result => {
      if (!active || !result) return;
      if ('code' in result) { pendingPhotoRecovery.clear(); setError('上次相机或相册未完成，可重新选择图片。'); }
      else if (!result.canceled) { setPendingAssets(result.assets); onPending(true); setNotice('找回了上次选择的图片。请确认它属于当前试卷，再保存。'); }
      else pendingPhotoRecovery.clear();
    }).catch(() => { if (active) setError('暂时无法恢复上次相册结果，可以重新选择。'); }).finally(() => { if (active) { setRestoring(false); onBusy(false); } });
    return () => { active = false; };
  }, [onBusy, onPending]);
  const run = async (task: () => Promise<void>) => {
    if (operation.current || disabled || restoring) return;
    operation.current = true; setWorking(true); onBusy(true); setError(''); setNotice('');
    try { await task(); } catch (cause) { setError(`${errorMessage(cause)} 已取得的照片保留在本机；如有保存冲突，请先重读页面记录。`); }
    finally { operation.current = false; setWorking(false); onBusy(false); }
  };
  const register = async (photo: PreparedPhoto) => {
    if (deletedIds.includes(photo.id)) throw new Error('这张图片已删除，请重新读取本机记录。');
    setPending(photo);
    const payload = photoRegistrationPayload(photo, uploads || [], localPhotoUri);
    await act('local.upload', { ...payload, purpose: 'homework' });
    await onChange(photo.id, true); setPending(null);
  };
  const saveAssets = async (assets: ImagePicker.ImagePickerAsset[]) => {
    for (let i = 0; i < assets.length; i++) {
      const photo = await prepareLocalPhoto(assets[i]);
      const remaining = assets.slice(i + 1);
      setPendingAssets(remaining);
      if (remaining.length) pendingPhotoRecovery.retain({ canceled: false, assets: remaining }); else pendingPhotoRecovery.clear();
      await register(photo);
    }
    setNotice('照片已保存到本机，并关联这份试卷。请对照原图逐题核对。');
  };
  const pick = (source: 'camera' | 'library') => run(async () => {
    await beforePick();
    if (source === 'camera') {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) { setPermissionDenied(true); throw new Error('尚未获得相机权限，可以打开系统设置，或使用相册。'); }
      setPermissionDenied(false);
    }
    const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], allowsEditing: false, quality: .85, base64: false, exif: false, allowsMultipleSelection: source === 'library', selectionLimit: Math.max(1, 10 - selectedIds.length) };
    const result = source === 'camera' ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
    if (result.canceled) { setNotice('已取消选择，原有照片和草稿都保留着。'); return; }
    pendingPhotoRecovery.retain(result); setPendingAssets(result.assets); await saveAssets(result.assets);
  });
  const locked = disabled || working || restoring;
  return <Card style={ls.section}>
    <Text style={styles.sectionTitle}>1 · 保存纸面照片</Text><Text style={styles.body}>保留完整题号、原答案和过程。可分多张拍摄，最多 10 张；本机不进行 OCR，稍后由你人工核对。</Text>
    {restoring && <Text style={styles.caption}>正在检查上次相机或相册结果，请稍等…</Text>}
    <Text style={styles.caption}>当前关联 {selectedIds.length} / 10 张 · 移出本卷不会删除本机原图</Text>
    {selected.map((upload, i) => <View key={upload.id} style={ls.section}><Text style={ls.label}>照片 {i + 1} · {upload.name}</Text><Image source={{ uri: localPhotoUri(upload.url) }} resizeMode="contain" style={{ height: 240, width: '100%', backgroundColor: '#F0F4EA', borderRadius: 12 }} accessibilityLabel={`本卷照片 ${i + 1}`} /><Button secondary label="从本卷移出这张照片" disabled={locked} onPress={() => { void run(() => onChange(upload.id, false)); }} /></View>)}
    {!!error && <Notice text={error} error />}{!!notice && <Notice text={notice} />}
    {pending && <View style={ls.section}><Image source={{ uri: localPhotoUri(pending.uri) }} resizeMode="contain" style={{ height: 170, width: '100%' }} /><Button label="重试关联已取得的照片" secondary disabled={locked} onPress={() => { void run(() => register(pending)); }} /></View>}
    {!!pendingAssets.length && <><Text style={styles.body}>还有 {pendingAssets.length} 张上次选择的图片待保存。</Text><Image source={{ uri: pendingAssets[0].uri }} resizeMode="contain" style={{ height: 170, width: '100%' }} /><Button label="确认属于本卷，保存剩余图片" secondary disabled={locked || !!pending || selectedIds.length + pendingAssets.length > 10} onPress={() => { void run(() => saveAssets(pendingAssets)); }} /></>}
    {(pending || pendingAssets.length > 0) && <Button label="暂不关联这次未完成的选择" secondary disabled={locked} onPress={() => Alert.alert('暂不关联待保存照片？', '已经复制到本机的照片仍可在“待关联图片”中找回；相册原图不会删除。尚未保存的相机结果可能需要重新拍摄。已在本卷列表中的照片可另行移出。', [{ text: '继续保存', style: 'cancel' }, { text: '暂不关联', onPress: () => { pendingPhotoRecovery.clear(); setPending(null); setPendingAssets([]); } }])} />}
    <Button label={working ? '正在保存照片…' : '拍摄一张纸面照片'} icon="camera" disabled={locked || !!pending || !!pendingAssets.length || selectedIds.length >= 10} onPress={() => { void pick('camera'); }} />
    <Button label="从系统相册选择" secondary icon="paper" disabled={locked || !!pending || !!pendingAssets.length || selectedIds.length >= 10} onPress={() => { void pick('library'); }} />
    {permissionDenied && <Button label="打开相机权限设置" secondary disabled={locked} onPress={() => { void Linking.openSettings().catch(cause => setError(errorMessage(cause))); }} />}
    {(available.length > 0 || recovered.length > 0) && <><Text style={ls.label}>本机已有的待关联图片</Text><Text style={styles.caption}>请核对图片属于当前卷名和版本后再加入，不会自动关联。</Text><ScrollView horizontal contentContainerStyle={{ gap: 12 }} showsHorizontalScrollIndicator={false}>{available.map(item => <View key={item.id} style={{ width: 180, gap: 8 }}><Image source={{ uri: localPhotoUri(item.url) }} resizeMode="contain" style={{ width: 180, height: 130 }} /><Text style={styles.caption}>{item.name}</Text><Button label="加入本卷" secondary disabled={locked || selectedIds.length >= 10} onPress={() => { void run(() => onChange(item.id, true)); }} /></View>)}{recovered.filter(item => item.id !== pending?.id).map(item => <View key={item.id} style={{ width: 180, gap: 8 }}><Image source={{ uri: localPhotoUri(item.uri) }} resizeMode="contain" style={{ width: 180, height: 130 }} /><Text style={styles.caption}>上次未完成登记的图片</Text><Button label="确认并找回图片" secondary disabled={locked || selectedIds.length >= 10} onPress={() => { void run(() => register(item)); }} /></View>)}</ScrollView></>}
  </Card>;
}
