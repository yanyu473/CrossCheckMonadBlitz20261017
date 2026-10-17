'use strict';
(() => {
  const $ = id => document.getElementById(id), P = window.ShowcaseProtocol;
  const state = {config:null, samples:[], selected:-1, report:null, verifying:false};
  const HASH = /^0x[0-9a-fA-F]{64}$/;
  const EVENT = ['event Certified(uint256 indexed id, address indexed issuer, bytes32 contentHash, bytes32 verdictHash, uint8 agreement, uint256 timestamp)'];
  const verdicts = {
    credible:{label:'可信',icon:'✓'}, questionable:{label:'存疑',icon:'?'},
    not_credible:{label:'不可信',icon:'×'}, unable_to_determine:{label:'无法判断',icon:'—'}
  };
  const agreements = {
    0:{label:'模型意见一致',className:'neutral',title:'相同的判断，也需要证据。',tab:'一致样例',en:'AGREEMENT'},
    1:{label:'模型意见分歧',className:'disagree',title:'看法不同，分歧也完整留下。',tab:'分歧样例',en:'DISAGREEMENT'},
    2:{label:'至少一方无法判断',className:'uncertain',title:'信息不足，保留判断的边界。',tab:'无法判断',en:'UNCERTAIN'}
  };
  const text = (element, value) => { element.textContent = String(value ?? '—'); };
  function create(tag, className, value) { const element = document.createElement(tag); if (className) element.className = className; if (value !== undefined) text(element,value); return element; }
  function message(value, type='pending') { $('verifyResult').className='message '+type; text($('verifyResult'),value); }
  function uint(value, field) { if (!/^(0|[1-9][0-9]*)$/.test(String(value))) throw new Error(field+'不是有效十进制整数'); return BigInt(value); }
  function sameAddress(a,b) { return typeof a==='string' && typeof b==='string' && a.toLowerCase()===b.toLowerCase(); }
  function reportFrom(value) {
    const report = value?.report || value;
    const validation = P.validateReportEnvelope(report);
    if (!validation.valid) throw new Error('报告格式无效：'+validation.errors.join('；'));
    if (report.payload.raw_text.length>10000) throw new Error('原文超过 10000 字符，本演示不接受该报告');
    return report;
  }
  function safeUrl(value) {
    try { const url = new URL(value); return ['https:','http:'].includes(url.protocol) && !url.username && !url.password ? url : null; } catch { return null; }
  }
  function explorerUrl(hash) {
    const base = safeUrl(state.config?.explorerUrl);
    if (!base || !HASH.test(hash || '')) return null;
    base.search=''; base.hash=''; base.pathname=base.pathname.replace(/\/$/,'')+'/tx/'+hash;
    return base.href;
  }
  function date(value) { const result=new Date(value); return Number.isNaN(result.getTime()) ? String(value) : result.toLocaleString('zh-CN',{hour12:false}); }
  function setControls() {
    for (const id of ['downloadReport','verifyCurrent','tamperAndVerify','verifyPasted','restoreOriginal']) $(id).disabled=!state.report || state.verifying;
    $('sampleTabs').querySelectorAll('button').forEach(button=>{button.disabled=state.verifying;});
    $('fileInput').disabled=state.verifying;
  }
  function renderModels(models,mode) {
    // mode 为 live 时这些报告来自真实上游调用，不能再说成"预设/非真实 API 返回"。
    const live=mode==='live';
    $('models').replaceChildren();
    for (const [index,model] of models.entries()) {
      const card=create('article','model-card');
      const top=create('div','model-topline'), identity=create('div','model-id'), details=create('div');
      identity.append(create('div','model-letter',model.slot.toUpperCase()));
      details.append(create('h4','', (live?'评审模型 ':'预设模型 ')+model.slot.toUpperCase()),create('p','',model.provider)); identity.append(details);
      top.append(identity,create('span','tag',live?'MODEL OUTPUT':'PRESET OUTPUT'));
      const verdict=verdicts[model.verdict] || {label:'调用失败',icon:'—'};
      card.append(top,create('div','small-label',live?'模型判断':'预设判断'),create('div','verdict '+(model.verdict || 'unable_to_determine'),verdict.icon+' '+verdict.label),create('p','reason-caption',live?'理由 / 模型原始返回，未经编辑':'演示理由 / 非真实 API 返回'),create('p','model-reason',model.reason || model.error_code || '未提供理由'),create('div','model-tech','请求模型：'+model.requested_model+'\n返回模型：'+(model.returned_model || '无')+' · 状态：'+model.status));
      card.style.animationDelay=(index*80)+'ms'; $('models').append(card);
    }
  }
  function choose(index) {
    if (state.verifying) return;
    const sample=state.samples[index]; if (!sample) return;
    state.selected=index; state.report=sample.report;
    const {payload,proof}=state.report, agreement=agreements[payload.agreement], hashes=P.computeHashes(payload);
    $('sampleTabs').querySelectorAll('button').forEach((button,position)=>{button.setAttribute('aria-selected',String(position===index));button.tabIndex=position===index ? 0 : -1;});
    text($('sampleTitle'),agreement.title); $('agreement').className='agreement '+agreement.className; text($('agreement'),agreement.label);
    renderModels(payload.models,payload.mode); text($('rawText'),payload.raw_text); text($('reportTime'),'报告完成 '+date(payload.completed_at));
    text($('certificateId'),proof.certificate_id);text($('chainId'),proof.chain_id);text($('blockNumber'),proof.block_number);text($('blockTime'),date(Number(proof.block_time)*1000));text($('txHash'),proof.tx_hash);
    text($('contentHash'),hashes.content_hash);text($('verdictHash'),hashes.verdict_hash);
    text($('proofIdentity'),'预期合约 '+state.config.contractAddress+'\n预期提交地址 '+state.config.issuerAddress+'\n回放数据不等于已独立核验，请在下方直读 RPC 对照。');
    const explorer=explorerUrl(proof.tx_hash);$('explorerLink').hidden=!explorer;if(explorer)$('explorerLink').href=explorer;
    $('reportJson').value=JSON.stringify(state.report,null,2);$('computedHashes').textContent='';
    message('已在浏览器复算全部报告字段，尚未查询链上交易。点击“核验原始报告”，直接从 Monad 测试网 RPC 核对。');setControls();
  }
  function download() {
    if(!state.report)return;
    const blob=new Blob([JSON.stringify(state.report,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),anchor=create('a');
    anchor.href=url;anchor.download='crosscheck-monad-cert-'+state.report.proof.certificate_id+'.json';anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  async function verify(value, source='报告', tamperExpected=false) {
    if(state.verifying)return;
    state.verifying=true;setControls();let provider=null;
    try {
      const report=reportFrom(value),{payload,proof}=report,hashes=P.computeHashes(payload),config=state.config;
      text($('computedHashes'),'本次核验来源：'+source+'\n原文指纹：'+hashes.content_hash+'\n完整报告指纹：'+hashes.verdict_hash);
      if(!proof)throw new Error('没有链上 proof，无法与交易回执核对');
      if(uint(proof.chain_id,'链 ID')!==10143n || Number(proof.chain_id)!==config.chainId)throw new Error('报告不是配置的 Monad 测试网链');
      if(!sameAddress(proof.contract_address,config.contractAddress))throw new Error('报告合约与配置的预期合约不符');
      if(!sameAddress(proof.issuer,config.issuerAddress))throw new Error('报告提交地址与预期地址不符');
      if(!HASH.test(proof.tx_hash))throw new Error('报告交易哈希无效');
      const rpc=safeUrl($('rpcInput').value.trim());if(!rpc)throw new Error('请填写有效的 http(s) RPC 地址，不得包含用户名或密码');
      message('浏览器正在直读 RPC：核对网络、交易回执与存证事件…\n'+source,'testing');
      const connection=new ethers.FetchRequest(rpc.href);connection.timeout=15000;
      provider=new ethers.JsonRpcProvider(connection,undefined,{batchMaxCount:1});
      const network=await provider.getNetwork();if(network.chainId!==10143n)throw new Error('RPC 返回的链 ID 不是 Monad 测试网 10143');
      const receipt=await provider.getTransactionReceipt(proof.tx_hash);
      if(!receipt || receipt.status!==1)throw new Error('RPC 未找到成功交易回执，尚不能验证');
      if(receipt.hash.toLowerCase()!==proof.tx_hash.toLowerCase())throw new Error('回执交易哈希不符');
      if(!sameAddress(receipt.to,config.contractAddress))throw new Error('回执交易目标不是预期存证合约');
      if(!sameAddress(receipt.from,config.issuerAddress))throw new Error('回执发送者不是预期提交地址');
      if(BigInt(receipt.blockNumber)!==uint(proof.block_number,'区块号'))throw new Error('报告区块号与回执不符');
      if(config.deploymentBlock!=null && BigInt(receipt.blockNumber)<uint(config.deploymentBlock,'部署区块'))throw new Error('回执早于配置的部署区块');
      const certificate=uint(proof.certificate_id,'凭证号');if(certificate<=0n)throw new Error('凭证号必须大于零');
      const iface=new ethers.Interface(EVENT),matches=[];
      for(const log of receipt.logs){if(!sameAddress(log.address,config.contractAddress))continue;try{const parsed=iface.parseLog(log);if(parsed?.name==='Certified' && parsed.args.id===certificate)matches.push(parsed.args);}catch{/* Other events are ignored. */}}
      if(matches.length!==1)throw new Error('预期合约未发出唯一匹配的凭证事件');
      const event=matches[0];if(!sameAddress(event.issuer,config.issuerAddress))throw new Error('事件提交地址不符');
      if(event.contentHash.toLowerCase()!==hashes.content_hash.toLowerCase())throw new Error('原文指纹不匹配，内容已被修改');
      if(event.verdictHash.toLowerCase()!==hashes.verdict_hash.toLowerCase())throw new Error('完整报告指纹不匹配：模型理由、判断或其他字段已被修改');
      if(Number(event.agreement)!==payload.agreement)throw new Error('一致性字段与链上事件不符');
      const block=await provider.getBlock(receipt.blockHash);
      if(!block || uint(proof.block_time,'区块时间')!==BigInt(block.timestamp) || event.timestamp!==BigInt(block.timestamp))throw new Error('报告、区块与事件时间不一致');
      if(tamperExpected)throw new Error('篡改样例意外匹配，不能作为成功的篡改检测演示');
      message('核验通过：'+source+'的完整指纹与真实 Monad 测试网事件一致。\n链 10143 · 凭证 #'+certificate+' · 区块 '+receipt.blockNumber+'\n已检查预期合约、提交地址、交易回执、全部模型字段指纹、一致性及区块时间。\n通过只代表"这份报告确实被签发、内容未被改动"，不代表判断本身正确。','success');
    } catch(error) {
      const reason=error?.shortMessage || error?.message || String(error);
      const detected=tamperExpected && /完整报告指纹不匹配/.test(reason);
      message((detected?'篡改已检出 · 链上核验未通过':'未通过链上核验')+'：'+reason+'\n'+(detected?'只改 models[0].reason 也会改变报告指纹。原始样例和链上记录均未修改。':'网络或 RPC 错误也会导致未通过，不应据此直接判定文件遭到篡改。'),'error');
    } finally {provider?.destroy();state.verifying=false;setControls();}
  }
  function parseText() {
    if($('reportJson').value.length>2*1024*1024)throw new Error('JSON 超过 2 MB');
    return JSON.parse($('reportJson').value);
  }
  function renderQr() {
    const url=new URL(location.href);url.hash='';
    text($('shareLink'),url.href);$('shareLink').href=url.href;
    if(!['https:','http:'].includes(url.protocol)){text($('shareNote'),'请通过 http(s) 静态服务打开；发布后二维码会自动指向公网地址。');return;}
    try{
      const qr=QRCode.create(url.href,{errorCorrectionLevel:'M'}),canvas=$('shareQr'),context=canvas.getContext('2d'),quiet=4,moduleSize=4,size=qr.modules.size;
      canvas.width=(size+quiet*2)*moduleSize;canvas.height=canvas.width;context.fillStyle='#ffffff';context.fillRect(0,0,canvas.width,canvas.height);context.fillStyle='#101426';
      for(let row=0;row<size;row++)for(let column=0;column<size;column++)if(qr.modules.get(row,column))context.fillRect((column+quiet)*moduleSize,(row+quiet)*moduleSize,moduleSize,moduleSize);
      text($('shareNote'),['localhost','127.0.0.1','[::1]'].includes(url.hostname)?'当前为本机预览链接；发布后二维码自动使用公网 URL。':'二维码只包含本页公开 URL，不包含导入文件或私钥。');
    }catch(error){$('shareQr').hidden=true;text($('shareNote'),'二维码生成失败，可直接打开上方页面链接。');}
  }
  $('downloadReport').addEventListener('click',download);
  $('verifyCurrent').addEventListener('click',()=>state.report && verify(state.report,'当前原始样例'));
  $('tamperAndVerify').addEventListener('click',()=>{
    if(!state.report || state.verifying)return;
    const changed=JSON.parse(JSON.stringify(state.report));changed.payload.models[0].reason=(changed.payload.models[0].reason || '')+'【此理由已修改，仅用于篡改检测】';
    $('reportJson').value=JSON.stringify(changed,null,2);$('jsonDetails').open=true;verify(changed,'仅修改嵌套模型理由的副本',true);
  });
  $('verifyPasted').addEventListener('click',()=>{try{verify(parseText(),'文本框中的报告');}catch(error){message('JSON 解析失败：'+error.message,'error');}});
  $('restoreOriginal').addEventListener('click',()=>{if(!state.report)return;$('reportJson').value=JSON.stringify(state.report,null,2);message('已恢复当前样例的原始 JSON。你可以再次核验，或自行修改嵌套字段后核验。');});
  $('fileInput').addEventListener('change',async event=>{
    const file=event.target.files?.[0];if(!file)return;
    try{if(file.size>2*1024*1024)throw new Error('文件超过 2 MB');const parsed=reportFrom(JSON.parse(await file.text()));$('reportJson').value=JSON.stringify(parsed,null,2);$('jsonDetails').open=true;verify(parsed,'导入的本地文件（上方卡片保留当前样例）');}
    catch(error){message('导入失败：'+error.message,'error');}finally{event.target.value='';}
  });
  $('sampleTabs').addEventListener('keydown',event=>{
    if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key) || state.verifying)return;
    event.preventDefault();let next=state.selected;
    if(event.key==='Home')next=0;else if(event.key==='End')next=state.samples.length-1;else next=(next+(event.key==='ArrowRight'?1:-1)+state.samples.length)%state.samples.length;
    choose(next);$('sampleTabs').querySelectorAll('button')[next]?.focus();
  });
  async function init() {
    try {
      if(!P || !window.ethers)throw new Error('本地协议或加密库未加载，请检查静态资源');
      const results=await Promise.all([fetch('./config.json',{cache:'no-store'}),fetch('./samples.json',{cache:'no-store'})]);
      if(results.some(response=>!response.ok))throw new Error('配置或样例文件尚未准备完成');
      const [rawConfig,rawSamples]=await Promise.all(results.map(response=>response.json()));
      const config={...rawConfig,chainId:Number(rawConfig.chainId ?? rawConfig.publicChainId)};
      if(config.chainId!==10143 || !ethers.isAddress(config.contractAddress) || !ethers.isAddress(config.issuerAddress) || sameAddress(config.contractAddress,ethers.ZeroAddress) || sameAddress(config.issuerAddress,ethers.ZeroAddress))throw new Error('静态配置缺少有效 Monad 测试网信任锚');
      if(!safeUrl(config.rpcUrl))throw new Error('配置没有可用的公开 RPC 地址');
      state.config=config;$('rpcInput').value=config.rpcUrl;
      if(!Array.isArray(rawSamples) || rawSamples.length<1)throw new Error('样例数组为空');
      state.samples=rawSamples.map(sample=>({name:String(sample.name || '演示样例'),report:reportFrom(sample.report)}));
      for(const sample of state.samples){const proof=sample.report.proof;if(!proof || proof.chain_id!==10143 || !sameAddress(proof.contract_address,config.contractAddress) || !sameAddress(proof.issuer,config.issuerAddress) || !['live','demo'].includes(sample.report.payload.mode))throw new Error('预设样例身份、链或模式与配置不符');}
      $('sampleTabs').replaceChildren();
      state.samples.forEach((sample,index)=>{const data=agreements[sample.report.payload.agreement],button=create('button','sample-tab');button.type='button';button.setAttribute('role','tab');button.setAttribute('aria-selected','false');button.append(create('span','',data.tab),create('small','',data.en));button.addEventListener('click',()=>choose(index));$('sampleTabs').append(button);});
      for(const [id,value] of [['sourceLink',config.sourceUrl],['fullServerLink',config.fullServerUrl || config.sourceUrl]]){const url=safeUrl(value);if(url){$(id).href=url.href;$(id).target='_blank';$(id).rel='noopener noreferrer';}}
      choose(Math.max(0,state.samples.findIndex(sample=>sample.report.payload.agreement===1)));renderQr();
    }catch(error){$('pageError').hidden=false;text($('pageError'),'页面尚未准备完成：'+error.message);setControls();renderQr();}
  }
  init();
})();
