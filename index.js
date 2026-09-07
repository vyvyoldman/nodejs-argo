#!/usr/bin/env node

const http = require("http");
const axios = require("axios");
const os = require("os");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { promisify } = require("util");
const { pipeline } = require("stream");
const exec = promisify(require("child_process").exec);
const pipelineAsync = promisify(pipeline);
const { execSync } = require("child_process");

const UPLOAD_URL = process.env.UPLOAD_URL || '';
const PROJECT_URL = process.env.PROJECT_URL || '';
const AUTO_ACCESS = process.env.AUTO_ACCESS || false;


// ============================================================
// 修复只读文件系统
// ============================================================

const RAW_FILE_PATH = process.env.FILE_PATH || '.tmp';

const FILE_PATH = path.isAbsolute(RAW_FILE_PATH)
  ? RAW_FILE_PATH
  : path.join('/tmp', RAW_FILE_PATH);

const SUB_PATH = process.env.SUB_PATH || 'sub';
const PORT = process.env.SERVER_PORT || process.env.PORT || 3000;

const UUID =
  process.env.UUID ||
  'd231e24d-7e23-4c1a-856b-c14f33329c6a';

const NEZHA_SERVER = process.env.NEZHA_SERVER || '';
const NEZHA_PORT = process.env.NEZHA_PORT || '';
const NEZHA_KEY = process.env.NEZHA_KEY || '';

const ARGO_DOMAIN = process.env.ARGO_DOMAIN || '';
const ARGO_AUTH = process.env.ARGO_AUTH || '';
const ARGO_PORT = process.env.ARGO_PORT || 8001;

const S5_PORT = process.env.S5_PORT || '';
const HY2_PORT = process.env.HY2_PORT || '';
const REALITY_PORT = process.env.REALITY_PORT || '';

const CFIP = process.env.CFIP || 'saas.sin.fan';
const CFPORT = process.env.CFPORT || 443;

const NAME = process.env.NAME || '';

const CHAT_ID = process.env.CHAT_ID || '';
const BOT_TOKEN = process.env.BOT_TOKEN || '';

const SHOW_LOG = !['false', 'disable', 'no'].includes(
  (process.env.SHOW_LOG || 'true').toLowerCase()
);


// ============================================================
// 控制日志
// ============================================================

if (!SHOW_LOG) {
  console.log = () => {};
  console.error = () => {};
}

function alwaysLog(msg) {
  process.stdout.write(msg + '\n');
}


// ============================================================
// 创建运行目录
// ============================================================

try {
  fs.mkdirSync(FILE_PATH, { recursive: true });
  console.log(`Runtime directory: ${FILE_PATH}`);
} catch (error) {
  console.error(`Failed to create runtime directory: ${FILE_PATH}`);
  console.error(error.message);
}


// ============================================================
// 端口检查
// ============================================================

function isValidPort(port) {
  try {
    if (port === null || port === undefined || port === '') {
      return false;
    }

    if (typeof port === 'string' && port.trim() === '') {
      return false;
    }

    const portNum = parseInt(port);

    if (isNaN(portNum)) return false;
    if (portNum < 1 || portNum > 65535) return false;

    return true;
  } catch {
    return false;
  }
}


// ============================================================
// 随机名称
// ============================================================

function generateRandomName() {
  const characters = 'abcdefghijklmnopqrstuvwxyz';

  let result = '';

  for (let i = 0; i < 6; i++) {
    result += characters.charAt(
      Math.floor(Math.random() * characters.length)
    );
  }

  return result;
}


// ============================================================
// 全局变量
// ============================================================

let subContent = null;
let privateKey = '';
let publicKey = '';

const npmName = generateRandomName();
const webName = generateRandomName();
const botName = generateRandomName();
const phpName = generateRandomName();

const npmPath = path.join(FILE_PATH, npmName);
const phpPath = path.join(FILE_PATH, phpName);
const webPath = path.join(FILE_PATH, webName);
const botPath = path.join(FILE_PATH, botName);

const subPath = path.join(FILE_PATH, 'sub.txt');
const listPath = path.join(FILE_PATH, 'list.txt');
const bootLogPath = path.join(FILE_PATH, 'boot.log');
const configPath = path.join(FILE_PATH, 'config.json');

const certPath = path.resolve(FILE_PATH, 'cert.pem');
const keyPath = path.resolve(FILE_PATH, 'private.key');


// ============================================================
// 工具：删除文件
// ============================================================

function removeFile(filePath, label = path.basename(filePath)) {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log(`${label} removed`);
    }
  } catch (error) {
    console.error(`Failed to remove ${label}: ${error.message}`);
  }
}


// ============================================================
// 工具：查看剩余空间
// ============================================================

function getFreeSpaceMB(dir = FILE_PATH) {
  try {
    const stat = fs.statfsSync(dir);

    return (
      stat.bavail *
      stat.bsize /
      1024 /
      1024
    );

  } catch {
    return -1;
  }
}


// ============================================================
// 删除历史节点
// ============================================================

function deleteNodes() {
  try {
    if (!UPLOAD_URL) return;
    if (!fs.existsSync(subPath)) return;

    let fileContent;

    try {
      fileContent = fs.readFileSync(
        subPath,
        'utf-8'
      );
    } catch {
      return null;
    }

    const decoded =
      Buffer.from(
        fileContent,
        'base64'
      ).toString('utf-8');

    const nodes =
      decoded
        .split('\n')
        .filter(line =>
          /(vless|vmess|trojan|hysteria2|socks):\/\//
            .test(line)
        );

    if (nodes.length === 0) return;

    axios.post(
      `${UPLOAD_URL}/api/delete-nodes`,
      JSON.stringify({ nodes }),
      {
        headers: {
          'Content-Type': 'application/json'
        }
      }
    ).catch(() => {});

  } catch {
    return null;
  }
}


// ============================================================
// 清理历史文件
// ============================================================

function cleanupOldFiles() {
  try {
    if (!fs.existsSync(FILE_PATH)) {
      fs.mkdirSync(FILE_PATH, {
        recursive: true
      });
      return;
    }

    const files = fs.readdirSync(FILE_PATH);

    files.forEach(file => {
      const filePath = path.join(
        FILE_PATH,
        file
      );

      try {
        const stat = fs.statSync(filePath);

        if (stat.isFile()) {
          fs.unlinkSync(filePath);
        }
      } catch {
        // 忽略
      }
    });

  } catch {
    // 忽略
  }
}


// ============================================================
// X25519
// ============================================================

function generateX25519Keypair() {
  const {
    publicKey: pubKey,
    privateKey: privKey
  } = crypto.generateKeyPairSync('x25519');

  const privateKeyRaw =
    privKey.export({
      type: 'pkcs8',
      format: 'der'
    }).subarray(-32);

  const publicKeyRaw =
    pubKey.export({
      type: 'spki',
      format: 'der'
    }).subarray(-32);

  return {
    privateKey:
      privateKeyRaw.toString('base64url'),

    publicKey:
      publicKeyRaw.toString('base64url')
  };
}


// ============================================================
// X25519 密钥
// ============================================================

function generateOrLoadKeyPair() {
  const keyFilePath =
    path.join(
      FILE_PATH,
      'key.txt'
    );

  if (fs.existsSync(keyFilePath)) {
    const content =
      fs.readFileSync(
        keyFilePath,
        'utf8'
      );

    const privateKeyMatch =
      content.match(
        /PrivateKey:\s*(.*)/
      );

    const publicKeyMatch =
      content.match(
        /PublicKey:\s*(.*)/
      );

    if (
      privateKeyMatch &&
      publicKeyMatch
    ) {
      privateKey =
        privateKeyMatch[1].trim();

      publicKey =
        publicKeyMatch[1].trim();

      console.log(
        'Private Key:',
        privateKey
      );

      console.log(
        'Public Key:',
        publicKey
      );

      return;
    }
  }

  const keypair =
    generateX25519Keypair();

  privateKey =
    keypair.privateKey;

  publicKey =
    keypair.publicKey;

  fs.writeFileSync(
    keyFilePath,
    `PrivateKey: ${privateKey}\nPublicKey: ${publicKey}\n`,
    'utf8'
  );

  console.log(
    'Private Key:',
    privateKey
  );

  console.log(
    'Public Key:',
    publicKey
  );
}


// ============================================================
// TLS
// ============================================================

const FALLBACK_EC_KEY =
  '-----BEGIN EC PARAMETERS-----\n' +
  'BggqhkjOPQMBBw==\n' +
  '-----END EC PARAMETERS-----\n' +
  '-----BEGIN EC PRIVATE KEY-----\n' +
  'MHcCAQEEIM4792SEtPqIt1ywqTd/0bYidBqpYV/++siNnfBYsdUYoAoGCCqGSM49\n' +
  'AwEHoUQDQgAE1kHafPj07rJG+HboH2ekAI4r+e6TL38GWASANnngZreoQDF16ARa\n' +
  '/TsyLyFoPkhLxSbehH/NBEjHtSZGaDhMqQ==\n' +
  '-----END EC PRIVATE KEY-----\n';

const FALLBACK_CERT =
  '-----BEGIN CERTIFICATE-----\n' +
  'MIIBejCCASGgAwIBAgIUfWeQL3556PNJLp/veCFxGNj9crkwCgYIKoZIzj0EAwIw\n' +
  'EzERMA8GA1UEAwwIYmluZy5jb20wHhcNMjUwOTE4MTgyMDIyWhcNMzUwOTE2MTgy\n' +
  'MDIyWjATMREwDwYDVQQDDAhiaW5nLmNvbTBZMBMGByqGSM49AgEGCCqGSM49AwEH\n' +
  'A0IABNZB2nz49O6yRvh26B9npACOK/nuky9/BlgEgDZ54Ga3qEAxdegEWv07Mi8h\n' +
  'aD5IS8Um3oR/zQRIx7UmRmg4TKmjUzBRMB0GA1UdDgQWBBTV1cFID7UISE7PLTBR\n' +
  'BfGbgkrMNzAfBgNVHSMEGDAWgBTV1cFID7UISE7PLTBRBfGbgkrMNzAPBgNVHRMB\n' +
  'Af8EBTADAQH/MAoGCCqGSM49BAMCA0cAMEQCIAIDAJvg0vd/ytrQVvEcSm6XTlB+\n' +
  'eQ6OFb9LbLYL9f+sAiAffoMbi4y/0YUSlTtz7as9S8/lciBF5VCUoVIKS+vX2g==\n' +
  '-----END CERTIFICATE-----\n';


function ensureTlsCertificates(
  certPath,
  keyPath
) {
  if (
    fs.existsSync(certPath) &&
    fs.existsSync(keyPath)
  ) {
    return;
  }

  fs.mkdirSync(
    path.dirname(certPath),
    {
      recursive: true
    }
  );

  try {
    execSync(
      'openssl version',
      {
        stdio: 'ignore'
      }
    );

    execSync(
      `openssl ecparam -genkey -name prime256v1 -out "${keyPath}"`,
      {
        stdio: 'ignore'
      }
    );

    execSync(
      `openssl req -new -x509 -days 3650 -key "${keyPath}" -out "${certPath}" -subj "/CN=bing.com"`,
      {
        stdio: 'ignore'
      }
    );

    return;

  } catch {
    // openssl 不可用
  }

  fs.writeFileSync(
    keyPath,
    FALLBACK_EC_KEY
  );

  fs.writeFileSync(
    certPath,
    FALLBACK_CERT
  );
}


// ============================================================
// 证书指纹
// ============================================================

function getCertificateFingerprint(
  certPath
) {
  try {
    const result =
      execSync(
        `openssl x509 -noout -fingerprint -sha256 -in "${certPath}"`,
        {
          encoding: 'utf8',
          timeout: 3000
        }
      ).trim();

    const match =
      result.match(
        /=(.+)$/
      );

    if (
      match &&
      match[1]
    ) {
      return match[1].toUpperCase();
    }

  } catch {
    // openssl 不可用
  }

  try {
    const certData =
      fs.readFileSync(
        certPath,
        'utf8'
      );

    const derMatch =
      certData.match(
        /-----BEGIN CERTIFICATE-----([\s\S]+?)-----END CERTIFICATE-----/
      );

    if (!derMatch) return '';

    const derBase64 =
      derMatch[1]
        .replace(/\s/g, '');

    const derBuffer =
      Buffer.from(
        derBase64,
        'base64'
      );

    const hash =
      crypto
        .createHash('sha256')
        .update(derBuffer)
        .digest('hex');

    return hash
      .match(/.{2}/g)
      .join(':')
      .toUpperCase();

  } catch (error) {
    console.error(
      'Failed to calculate certificate fingerprint:',
      error
    );

    return '';
  }
}


// ============================================================
// Xray 配置
// ============================================================

async function generateConfig() {

  const config = {

    log: {
      access: '/dev/null',
      error: '/dev/null',
      loglevel: 'none'
    },

    inbounds: [

      {
        tag: 'vless-fallback-in',
        port: ARGO_PORT,
        listen: '::',
        protocol: 'vless',

        settings: {

          clients: [
            {
              id: UUID,
              flow: 'xtls-rprx-vision'
            }
          ],

          decryption: 'none',

          fallbacks: [
            {
              dest: 3001
            },
            {
              path: '/vless-argo',
              dest: 3002
            },
            {
              path: '/vmess-argo',
              dest: 3003
            },
            {
              path: '/trojan-argo',
              dest: 3004
            }
          ]
        },

        streamSettings: {
          network: 'tcp'
        }
      },


      {
        tag: 'vless-tcp-in',
        port: 3001,
        listen: '127.0.0.1',
        protocol: 'vless',

        settings: {
          clients: [
            {
              id: UUID
            }
          ],
          decryption: 'none'
        },

        streamSettings: {
          network: 'tcp',
          security: 'none'
        }
      },


      {
        tag: 'vless-ws-in',
        port: 3002,
        listen: '127.0.0.1',
        protocol: 'vless',

        settings: {

          clients: [
            {
              id: UUID,
              level: 0
            }
          ],

          decryption: 'none'
        },

        streamSettings: {

          network: 'ws',
          security: 'none',

          wsSettings: {
            path: '/vless-argo'
          }
        },

        sniffing: {
          enabled: true,
          destOverride: [
            'http',
            'tls',
            'quic'
          ],
          metadataOnly: false
        }
      },


      {
        tag: 'vmess-ws-in',
        port: 3003,
        listen: '127.0.0.1',
        protocol: 'vmess',

        settings: {
          clients: [
            {
              id: UUID,
              alterId: 0
            }
          ]
        },

        streamSettings: {

          network: 'ws',

          wsSettings: {
            path: '/vmess-argo'
          }
        },

        sniffing: {
          enabled: true,
          destOverride: [
            'http',
            'tls',
            'quic'
          ],
          metadataOnly: false
        }
      },


      {
        tag: 'trojan-ws-in',
        port: 3004,
        listen: '127.0.0.1',
        protocol: 'trojan',

        settings: {
          clients: [
            {
              password: UUID
            }
          ]
        },

        streamSettings: {

          network: 'ws',
          security: 'none',

          wsSettings: {
            path: '/trojan-argo'
          }
        },

        sniffing: {
          enabled: true,
          destOverride: [
            'http',
            'tls',
            'quic'
          ],
          metadataOnly: false
        }
      }

    ],


    dns: {
      servers: [
        'https+local://8.8.8.8/dns-query'
      ]
    },


    outbounds: [
      {
        protocol: 'freedom',
        tag: 'direct'
      },
      {
        protocol: 'blackhole',
        tag: 'block'
      }
    ]
  };


  // ==========================================================
  // Reality
  // ==========================================================

  if (isValidPort(REALITY_PORT)) {

    config.inbounds.push({

      tag: 'vless-in',

      listen: '::',

      port: parseInt(
        REALITY_PORT
      ),

      protocol: 'vless',

      settings: {

        clients: [
          {
            id: UUID,
            flow: 'xtls-rprx-vision'
          }
        ],

        decryption: 'none'
      },

      streamSettings: {

        network: 'raw',
        security: 'reality',

        realitySettings: {

          show: false,

          dest:
            'www.iij.ad.jp:443',

          xver: 0,

          serverNames: [
            'www.iij.ad.jp'
          ],

          privateKey:
            privateKey,

          shortIds: [
            ''
          ]
        }
      }
    });
  }


  // ==========================================================
  // Hysteria2
  // ==========================================================

  if (isValidPort(HY2_PORT)) {

    config.inbounds.push({

      tag: 'hysteria-in',

      listen: '::',

      port: parseInt(
        HY2_PORT
      ),

      protocol: 'hysteria',

      settings: {

        version: 2,

        clients: [
          {
            auth: UUID
          }
        ]
      },

      streamSettings: {

        network: 'hysteria',

        hysteriaSettings: {

          version: 2,

          masquerade: {
            type: 'proxy',
            url: 'https://bing.com'
          }
        },

        security: 'tls',

        tlsSettings: {

          alpn: [
            'h3'
          ],

          certificates: [
            {
              certificateFile:
                certPath,

              keyFile:
                keyPath
            }
          ]
        }
      }
    });
  }


  // ==========================================================
  // SOCKS5
  // ==========================================================

  if (isValidPort(S5_PORT)) {

    config.inbounds.push({

      tag: 's5-in',

      listen: '::',

      port: parseInt(
        S5_PORT
      ),

      protocol: 'socks',

      settings: {

        auth: 'password',

        accounts: [
          {
            user:
              UUID.substring(0, 8),

            pass:
              UUID.slice(-12)
          }
        ],

        udp: true
      }
    });
  }


  // ==========================================================
  // 写配置
  // ==========================================================

  fs.writeFileSync(
    configPath,
    JSON.stringify(
      config,
      null,
      2
    )
  );
}


// ============================================================
// 架构
// ============================================================

function getSystemArchitecture() {

  const arch =
    os.arch();

  if (
    arch === 'arm' ||
    arch === 'arm64' ||
    arch === 'aarch64'
  ) {
    return 'arm';
  }

  return 'amd';
}


// ============================================================
// 下载文件
// ============================================================

async function downloadFile(
  fileName,
  fileUrl
) {

  const filePath = fileName;

  try {

    if (!fs.existsSync(FILE_PATH)) {
      fs.mkdirSync(
        FILE_PATH,
        {
          recursive: true
        }
      );
    }


    const freeBefore =
      getFreeSpaceMB(
        FILE_PATH
      );

    console.log(
      `Free space before downloading ${path.basename(filePath)}: ${
        freeBefore >= 0
          ? freeBefore.toFixed(1) + ' MB'
          : 'unknown'
      }`
    );


    const response =
      await axios({
        method: 'get',
        url: fileUrl,
        responseType: 'stream',
        timeout: 120000,

        maxContentLength:
          Infinity,

        maxBodyLength:
          Infinity
      });


    const contentLength =
      Number(
        response.headers[
          'content-length'
        ] || 0
      );


    if (
      contentLength > 0 &&
      freeBefore >= 0
    ) {

      const requiredMB =
        contentLength /
        1024 /
        1024;

      console.log(
        `Download size: ${requiredMB.toFixed(1)} MB`
      );

      if (
        freeBefore <
        requiredMB + 5
      ) {

        throw new Error(
          `insufficient disk space: ${freeBefore.toFixed(1)} MB free, approximately ${requiredMB.toFixed(1)} MB required`
        );
      }
    }


    const writer =
      fs.createWriteStream(
        filePath
      );


    await pipelineAsync(
      response.data,
      writer
    );


    console.log(
      `Download ${path.basename(filePath)} successfully`
    );


    const freeAfter =
      getFreeSpaceMB(
        FILE_PATH
      );

    console.log(
      `Free space after downloading ${path.basename(filePath)}: ${
        freeAfter >= 0
          ? freeAfter.toFixed(1) + ' MB'
          : 'unknown'
      }`
    );


    return filePath;

  } catch (err) {

    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch {
      // 忽略
    }


    const errorMessage =
      `Download ${path.basename(filePath)} failed: ${err.message}`;

    console.error(
      errorMessage
    );

    throw new Error(
      errorMessage
    );
  }
}


// ============================================================
// 授权
// ============================================================

function authorizeFile(filePath) {

  if (!fs.existsSync(filePath)) {
    return false;
  }

  try {

    fs.chmodSync(
      filePath,
      0o775
    );

    console.log(
      `Permission success: ${path.basename(filePath)}`
    );

    return true;

  } catch (error) {

    console.error(
      `Permission failed for ${path.basename(filePath)}: ${error.message}`
    );

    return false;
  }
}


// ============================================================
// 下载并运行
// ============================================================

async function downloadFilesAndRun() {

  const architecture =
    getSystemArchitecture();

  const filesToDownload =
    getFilesForArchitecture(
      architecture
    );


  if (
    filesToDownload.length === 0
  ) {

    console.log(
      `Can't find a file for the current architecture`
    );

    return false;
  }


  console.log(
    `Architecture: ${architecture}`
  );

  console.log(
    `Files to download: ${filesToDownload.length}`
  );


  // ==========================================================
  // 关键修改：
  // 不再 Promise.all
  // 一个下载完成后再下载下一个
  // ==========================================================

  for (
    const fileInfo of filesToDownload
  ) {

    try {

      console.log(
        `Starting download: ${path.basename(fileInfo.fileName)}`
      );

      await downloadFile(
        fileInfo.fileName,
        fileInfo.fileUrl
      );

    } catch (err) {

      console.error(
        `Failed to download ${path.basename(fileInfo.fileName)}: ${err.message}`
      );

      continue;
    }
  }


  // ==========================================================
  // 检查必要文件
  // ==========================================================

  if (!fs.existsSync(webPath)) {

    console.error(
      'Xray binary was not downloaded. Stop.'
    );

    return false;
  }


  authorizeFile(
    webPath
  );


  if (
    NEZHA_SERVER &&
    NEZHA_KEY
  ) {

    if (NEZHA_PORT) {
      authorizeFile(
        npmPath
      );
    } else {
      authorizeFile(
        phpPath
      );
    }
  }


  if (fs.existsSync(botPath)) {
    authorizeFile(
      botPath
    );
  }


  // ==========================================================
  // 哪吒
  // ==========================================================

  if (
    NEZHA_SERVER &&
    NEZHA_KEY
  ) {

    if (!NEZHA_PORT) {

      const port =
        NEZHA_SERVER.includes(':')
          ? NEZHA_SERVER.split(':').pop()
          : '';

      const tlsPorts =
        new Set([
          '443',
          '8443',
          '2096',
          '2087',
          '2083',
          '2053'
        ]);

      const nezhatls =
        tlsPorts.has(port)
          ? 'true'
          : 'false';


      const configYaml = `
client_secret: ${NEZHA_KEY}
debug: false
disable_auto_update: true
disable_command_execute: false
disable_force_update: true
disable_nat: false
disable_send_query: false
gpu: false
insecure_tls: true
ip_report_period: 1800
report_delay: 4
server: ${NEZHA_SERVER}
skip_connection_count: true
skip_procs_count: true
temperature: false
tls: ${nezhatls}
use_gitee_to_upgrade: false
use_ipv6_country_code: false
uuid: ${UUID}`;


      fs.writeFileSync(
        path.join(
          FILE_PATH,
          'config.yaml'
        ),
        configYaml
      );


      if (
        fs.existsSync(
          phpPath
        )
      ) {

        const command =
          `nohup ${phpPath} -c "${FILE_PATH}/config.yaml" >/dev/null 2>&1 &`;

        try {

          await exec(
            command
          );

          console.log(
            `${phpName} is running`
          );

          await new Promise(
            resolve =>
              setTimeout(
                resolve,
                1000
              )
          );


          // ==================================================
          // 关键修改：启动后删除哪吒二进制
          // ==================================================

          removeFile(
            phpPath,
            phpName
          );

        } catch (error) {

          console.error(
            `php running error: ${error.message}`
          );
        }
      }

    } else {

      let NEZHA_TLS = '';

      const tlsPorts = [
        '443',
        '8443',
        '2096',
        '2087',
        '2083',
        '2053'
      ];

      if (
        tlsPorts.includes(
          NEZHA_PORT
        )
      ) {
        NEZHA_TLS = '--tls';
      }


      if (
        fs.existsSync(
          npmPath
        )
      ) {

        const command =
          `nohup ${npmPath} -s ${NEZHA_SERVER}:${NEZHA_PORT} -p ${NEZHA_KEY} ${NEZHA_TLS} --disable-auto-update --report-delay 4 --skip-conn --skip-procs >/dev/null 2>&1 &`;

        try {

          await exec(
            command
          );

          console.log(
            `${npmName} is running`
          );

          await new Promise(
            resolve =>
              setTimeout(
                resolve,
                1000
              )
          );


          // ==================================================
          // 关键修改
          // ==================================================

          removeFile(
            npmPath,
            npmName
          );

        } catch (error) {

          console.error(
            `npm running error: ${error.message}`
          );
        }
      }
    }

  } else {

    console.log(
      'NEZHA variable is empty, skip running'
    );
  }


  // ==========================================================
  // Xray
  // ==========================================================

  const command1 =
    `nohup ${webPath} -c "${configPath}" >/dev/null 2>&1 &`;


  try {

    await exec(
      command1
    );

    console.log(
      `${webName} is running`
    );


    await new Promise(
      resolve =>
        setTimeout(
          resolve,
          1000
        )
    );


    // ========================================================
    // 关键修改：
    // Linux 下正在运行的程序可以删除其可执行文件
    // 进程继续运行，但立即释放磁盘空间
    // ========================================================

    removeFile(
      webPath,
      webName
    );

  } catch (error) {

    console.error(
      `web running error: ${error.message}`
    );

    return false;
  }


  // ==========================================================
  // Cloudflared
  // ==========================================================

  if (
    fs.existsSync(botPath)
  ) {

    let args;


    if (
      ARGO_AUTH.match(
        /^[A-Z0-9a-z=]{120,250}$/
      )
    ) {

      args =
        `tunnel --edge-ip-version auto --no-autoupdate --protocol http2 run --token ${ARGO_AUTH}`;

    } else if (
      ARGO_AUTH.match(
        /TunnelSecret/
      )
    ) {

      args =
        `tunnel --edge-ip-version auto --config "${FILE_PATH}/tunnel.yml" run`;

    } else {

      args =
        `tunnel --edge-ip-version auto --no-autoupdate --protocol http2 --logfile "${bootLogPath}" --loglevel info --url http://localhost:${ARGO_PORT}`;
    }


    try {

      await exec(
        `nohup ${botPath} ${args} >/dev/null 2>&1 &`
      );


      console.log(
        `${botName} is running`
      );


      await new Promise(
        resolve =>
          setTimeout(
            resolve,
            2000
          )
      );


    } catch (error) {

      console.error(
        `Error executing cloudflared: ${error.message}`
      );

      return false;
    }
  } else {

    console.error(
      'Cloudflared binary does not exist.'
    );

    return false;
  }


  await new Promise(
    resolve =>
      setTimeout(
        resolve,
        5000
      )
  );


  return true;
}


// ============================================================
// 架构文件
// ============================================================

function getFilesForArchitecture(
  architecture
) {

  let baseFiles;


  if (
    architecture === 'arm'
  ) {

    baseFiles = [

      {
        fileName:
          webPath,

        fileUrl:
          'https://arm64.ssss.nyc.mn/web'
      },

      {
        fileName:
          botPath,

        fileUrl:
          'https://arm64.ssss.nyc.mn/bot'
      }

    ];

  } else {

    baseFiles = [

      {
        fileName:
          webPath,

        fileUrl:
          'https://amd64.ssss.nyc.mn/web'
      },

      {
        fileName:
          botPath,

        fileUrl:
          'https://amd64.ssss.nyc.mn/bot'
      }

    ];
  }


  if (
    NEZHA_SERVER &&
    NEZHA_KEY
  ) {

    if (NEZHA_PORT) {

      const npmUrl =
        architecture === 'arm'
          ? 'https://arm64.ssss.nyc.mn/agent'
          : 'https://amd64.ssss.nyc.mn/agent';


      baseFiles.unshift({

        fileName:
          npmPath,

        fileUrl:
          npmUrl

      });

    } else {

      const phpUrl =
        architecture === 'arm'
          ? 'https://arm64.ssss.nyc.mn/v1'
          : 'https://amd64.ssss.nyc.mn/v1';


      baseFiles.unshift({

        fileName:
          phpPath,

        fileUrl:
          phpUrl

      });
    }
  }


  return baseFiles;
}


// ============================================================
// 固定 Argo
// ============================================================

function argoType() {

  if (
    !ARGO_AUTH ||
    !ARGO_DOMAIN
  ) {

    console.log(
      'ARGO_DOMAIN or ARGO_AUTH is empty, use quick tunnels'
    );

    return;
  }


  if (
    ARGO_AUTH.includes(
      'TunnelSecret'
    )
  ) {

    fs.writeFileSync(
      path.join(
        FILE_PATH,
        'tunnel.json'
      ),
      ARGO_AUTH
    );


    const tunnelYaml = `
tunnel: ${ARGO_AUTH.split('"')[11]}
credentials-file: ${path.join(FILE_PATH, 'tunnel.json')}
protocol: http2

ingress:
  - hostname: ${ARGO_DOMAIN}
    service: http://localhost:${ARGO_PORT}
    originRequest:
      noTLSVerify: true
  - service: http_status:404
`;


    fs.writeFileSync(
      path.join(
        FILE_PATH,
        'tunnel.yml'
      ),
      tunnelYaml
    );

  } else {

    console.log(
      `Using token connect to tunnel, please set ${ARGO_PORT} in Cloudflare`
    );
  }
}


// ============================================================
// 获取 Argo Domain
// ============================================================

async function extractDomains() {

  let argoDomain;


  // ==========================================================
  // 固定隧道
  // ==========================================================

  if (
    ARGO_AUTH &&
    ARGO_DOMAIN
  ) {

    argoDomain =
      ARGO_DOMAIN;

    console.log(
      'ARGO_DOMAIN:',
      argoDomain
    );


    await generateLinks(
      argoDomain
    );


    // 固定隧道不需要 boot.log
    // token 模式同样不删除 cloudflared
    // 让它持续运行

    return;
  }


  // ==========================================================
  // Quick Tunnel
  // ==========================================================

  try {

    if (
      !fs.existsSync(
        bootLogPath
      )
    ) {

      console.error(
        'boot.log does not exist. Cloudflared may not have started correctly.'
      );

      return false;
    }


    const fileContent =
      fs.readFileSync(
        bootLogPath,
        'utf-8'
      );


    const lines =
      fileContent.split('\n');

    const argoDomains = [];


    lines.forEach(
      line => {

        const domainMatch =
          line.match(
            /https?:\/\/([^ ]*trycloudflare\.com)\/?/
          );


        if (domainMatch) {

          const domain =
            domainMatch[1];

          argoDomains.push(
            domain
          );
        }
      }
    );


    if (
      argoDomains.length > 0
    ) {

      argoDomain =
        argoDomains[0];


      console.log(
        'ArgoDomain:',
        argoDomain
      );


      await generateLinks(
        argoDomain
      );


      // ======================================================
      // 关键修改：
      // 已经拿到 Quick Tunnel 域名后再删除 cloudflared
      // ======================================================

      removeFile(
        botPath,
        botName
      );


      return true;

    }


    // ========================================================
    // 没找到域名，重新启动
    // ========================================================

    console.log(
      'ArgoDomain not found, re-running bot to obtain ArgoDomain'
    );


    if (
      fs.existsSync(
        bootLogPath
      )
    ) {

      removeFile(
        bootLogPath,
        'boot.log'
      );
    }


    async function killBotProcess() {

      try {

        if (
          process.platform === 'win32'
        ) {

          await exec(
            `taskkill /f /im ${botName}.exe > nul 2>&1`
          );

        } else {

          await exec(
            `pkill -f "[${botName.charAt(0)}]${botName.substring(1)}" > /dev/null 2>&1`
          );
        }

      } catch {
        // 忽略
      }
    }


    await killBotProcess();


    await new Promise(
      resolve =>
        setTimeout(
          resolve,
          3000
        )
    );


    if (
      !fs.existsSync(
        botPath
      )
    ) {

      console.error(
        'Cloudflared binary no longer exists, cannot retry.'
      );

      return false;
    }


    const args =
      `tunnel --edge-ip-version auto --no-autoupdate --protocol http2 --logfile "${bootLogPath}" --loglevel info --url http://localhost:${ARGO_PORT}`;


    try {

      await exec(
        `nohup ${botPath} ${args} >/dev/null 2>&1 &`
      );


      console.log(
        `${botName} is running`
      );


      await new Promise(
        resolve =>
          setTimeout(
            resolve,
            6000
          )
      );


      return await extractDomains();

    } catch (error) {

      console.error(
        `Error executing command: ${error.message}`
      );

      return false;
    }

  } catch (error) {

    console.error(
      'Error reading boot.log:',
      error.message
    );

    return false;
  }
}


// ============================================================
// ISP
// ============================================================

async function getMetaInfo() {

  try {

    const response1 =
      await axios.get(
        'https://api.ip.sb/geoip',
        {
          headers: {
            'User-Agent':
              'Mozilla/5.0'
          },

          timeout: 3000
        }
      );


    if (
      response1.data &&
      response1.data.country_code &&
      response1.data.isp
    ) {

      return `${response1.data.country_code}-${response1.data.isp}`
        .replace(/\s+/g, '_');
    }

  } catch {

    try {

      const response2 =
        await axios.get(
          'http://ip-api.com/json',
          {
            headers: {
              'User-Agent':
                'Mozilla/5.0'
            },

            timeout: 3000
          }
        );


      if (
        response2.data &&
        response2.data.status === 'success' &&
        response2.data.countryCode &&
        response2.data.org
      ) {

        return `${response2.data.countryCode}-${response2.data.org}`
          .replace(/\s+/g, '_');
      }

    } catch {
      // backup failed
    }
  }


  return 'Unknown';
}


// ============================================================
// 公网 IP
// ============================================================

async function getServerIP() {

  let serverIP = '';


  try {

    const ipv4Response =
      await axios.get(
        'http://ipv4.ip.sb',
        {
          timeout: 3000
        }
      );


    serverIP =
      ipv4Response.data.trim();

  } catch {

    try {

      serverIP =
        execSync(
          'curl -sm 3 ipv4.ip.sb'
        )
          .toString()
          .trim();

    } catch {

      try {

        const ipv6Response =
          await axios.get(
            'http://ipv6.ip.sb',
            {
              timeout: 3000
            }
          );


        serverIP =
          `[${ipv6Response.data.trim()}]`;

      } catch {

        try {

          serverIP =
            `[${execSync(
              'curl -sm 3 ipv6.ip.sb'
            )
              .toString()
              .trim()}]`;

        } catch (ipv6CurlErr) {

          console.error(
            'Failed to get IP address:',
            ipv6CurlErr.message
          );
        }
      }
    }
  }


  return serverIP;
}


// ============================================================
// 生成节点
// ============================================================

async function generateLinks(
  argoDomain
) {

  const ISP =
    await getMetaInfo();


  const nodeName =
    NAME
      ? `${NAME}-${ISP}`
      : ISP;


  const SERVER_IP =
    await getServerIP();


  return new Promise(
    resolve => {

      setTimeout(
        () => {

          const VMESS = {

            v: '2',

            ps:
              `${nodeName}`,

            add:
              CFIP,

            port:
              CFPORT,

            id:
              UUID,

            aid:
              '0',

            scy:
              'auto',

            net:
              'ws',

            type:
              'none',

            host:
              argoDomain,

            path:
              '/vmess-argo?ed=2560',

            tls:
              'tls',

            sni:
              argoDomain,

            alpn:
              '',

            fp:
              'firefox'
          };


          let subTxt = `

vless://${UUID}@${CFIP}:${CFPORT}?encryption=none&security=tls&sni=${argoDomain}&fp=firefox&type=ws&host=${argoDomain}&path=%2Fvless-argo%3Fed%3D2560#${nodeName}

vmess://${Buffer
  .from(
    JSON.stringify(VMESS)
  )
  .toString('base64')}

trojan://${UUID}@${CFIP}:${CFPORT}?security=tls&sni=${argoDomain}&fp=firefox&type=ws&host=${argoDomain}&path=%2Ftrojan-argo%3Fed%3D2560#${nodeName}
`;


          // ==================================================
          // HY2
          // ==================================================

          if (
            isValidPort(
              HY2_PORT
            )
          ) {

            const fingerprint =
              getCertificateFingerprint(
                certPath
              );


            const fingerprintParam =
              fingerprint
                ? `&pinSHA256=${encodeURIComponent(fingerprint)}`
                : '';


            const hysteriaNode =
              `\nhysteria2://${UUID}@${SERVER_IP}:${HY2_PORT}/?sni=www.bing.com&insecure=0&alpn=h3&obfs=none${fingerprintParam}#${nodeName}`;


            subTxt +=
              hysteriaNode;
          }


          // ==================================================
          // Reality
          // ==================================================

          if (
            isValidPort(
              REALITY_PORT
            )
          ) {

            const vlessNode =
              `\nvless://${UUID}@${SERVER_IP}:${REALITY_PORT}?encryption=none&flow=xtls-rprx-vision&security=reality&sni=www.iij.ad.jp&fp=firefox&pbk=${publicKey}&type=tcp&headerType=none#${nodeName}`;


            subTxt +=
              vlessNode;
          }


          // ==================================================
          // SOCKS5
          // ==================================================

          if (
            isValidPort(
              S5_PORT
            )
          ) {

            const S5_AUTH =
              Buffer
                .from(
                  `${UUID.substring(0, 8)}:${UUID.slice(-12)}`
                )
                .toString('base64');


            const s5Node =
              `\nsocks://${S5_AUTH}@${SERVER_IP}:${S5_PORT}#${nodeName}`;


            subTxt +=
              s5Node;
          }


          console.log(
            Buffer
              .from(subTxt)
              .toString('base64')
          );


          fs.writeFileSync(
            subPath,
            Buffer
              .from(subTxt)
              .toString('base64')
          );


          fs.writeFileSync(
            listPath,
            subTxt,
            'utf8'
          );


          console.log(
            `${FILE_PATH}/sub.txt saved successfully`
          );


          subContent =
            Buffer
              .from(subTxt)
              .toString('base64');


          uploadNodes();


          resolve(
            subTxt
          );

        },
        2000
      );
    }
  );
}


// ============================================================
// 上传
// ============================================================

async function uploadNodes() {

  if (
    UPLOAD_URL &&
    PROJECT_URL
  ) {

    const subscriptionUrl =
      `${PROJECT_URL}/${SUB_PATH}`;


    const jsonData = {
      subscription: [
        subscriptionUrl
      ]
    };


    try {

      const response =
        await axios.post(
          `${UPLOAD_URL}/api/add-subscriptions`,
          jsonData,
          {
            headers: {
              'Content-Type':
                'application/json'
            }
          }
        );


      if (
        response &&
        response.status === 200
      ) {

        console.log(
          'Subscription uploaded successfully'
        );

        return response;
      }

    } catch (error) {

      if (
        error.response &&
        error.response.status === 400
      ) {
        // 已存在
      }
    }

  } else if (
    UPLOAD_URL
  ) {

    if (
      !fs.existsSync(
        listPath
      )
    ) {
      return;
    }


    const content =
      fs.readFileSync(
        listPath,
        'utf-8'
      );


    const nodes =
      content
        .split('\n')
        .filter(
          line =>
            /(vless|vmess|trojan|hysteria2|socks):\/\//
              .test(line)
        );


    if (
      nodes.length === 0
    ) {
      return;
    }


    const jsonData =
      JSON.stringify({
        nodes
      });


    try {

      const response =
        await axios.post(
          `${UPLOAD_URL}/api/add-nodes`,
          jsonData,
          {
            headers: {
              'Content-Type':
                'application/json'
            }
          }
        );


      if (
        response &&
        response.status === 200
      ) {

        console.log(
          'Nodes uploaded successfully'
        );

        return response;
      }

    } catch {
      return null;
    }

  } else {

    return;
  }
}


// ============================================================
// 90 秒后删除文件
// ============================================================

function cleanFiles() {

  setTimeout(
    () => {

      const filesToDelete = [

        bootLogPath,
        configPath,
        listPath,
        certPath,
        keyPath,
        path.join(
          FILE_PATH,
          'config.yaml'
        ),
        path.join(
          FILE_PATH,
          'tunnel.json'
        ),
        path.join(
          FILE_PATH,
          'tunnel.yml'
        )

      ];


      if (
        NEZHA_PORT
      ) {

        filesToDelete.push(
          npmPath
        );

      } else if (
        NEZHA_SERVER &&
        NEZHA_KEY
      ) {

        filesToDelete.push(
          phpPath
        );
      }


      // ======================================================
      // 注意：
      // webPath / botPath 可能已经被前面主动删除
      // 这里再删一次也不会有问题
      // ======================================================

      filesToDelete.push(
        webPath,
        botPath
      );


      filesToDelete.forEach(
        file => {

          try {

            if (
              fs.existsSync(file)
            ) {

              fs.unlinkSync(
                file
              );
            }

          } catch {
            // 忽略
          }
        }
      );


      console.clear();


      alwaysLog(
        'App is running'
      );


      console.log(
        'Thank you for using this script, enjoy!'
      );

    },
    90000
  );
}


// ============================================================
// Telegram
// ============================================================

async function sendTelegram() {

  if (
    !BOT_TOKEN ||
    !CHAT_ID
  ) {

    console.log(
      'TG variables is empty, Skipping push nodes to TG'
    );

    return;
  }


  try {

    const message =
      fs.readFileSync(
        subPath,
        'utf8'
      );


    const url =
      `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;


    const escapedName =
      NAME.replace(
        /[_*\[\]()~`>#+=|{}.!-]/g,
        '\\$&'
      );


    const params = {

      chat_id:
        CHAT_ID,

      text:
        `**${escapedName}节点推送**\n\`\`\`${message}\`\`\``,

      parse_mode:
        'MarkdownV2'
    };


    await axios.post(
      url,
      null,
      {
        params
      }
    );


    console.log(
      'Telegram message sent successfully'
    );

  } catch (error) {

    console.error(
      'Failed to send Telegram message:',
      error.message
    );
  }
}


// ============================================================
// 自动访问
// ============================================================

async function AddVisitTask() {

  if (
    !AUTO_ACCESS ||
    !PROJECT_URL
  ) {

    console.log(
      'Skipping adding automatic access task'
    );

    return;
  }


  try {

    await axios.post(
      'https://oooo.serv00.net/add-url',
      {
        url: PROJECT_URL
      },
      {
        headers: {
          'Content-Type':
            'application/json'
        }
      }
    );


    console.log(
      'automatic access task added successfully'
    );

  } catch (error) {

    console.error(
      `Add automatic access task faild: ${error.message}`
    );
  }
}


// ============================================================
// 主运行逻辑
// ============================================================

async function startserver() {

  try {

    console.log(
      `Using writable directory: ${FILE_PATH}`
    );


    // ========================================================
    // 先清理旧文件
    // ========================================================

    deleteNodes();

    cleanupOldFiles();


    // ========================================================
    // 再生成固定 Argo 配置
    // ========================================================

    argoType();


    // ========================================================
    // Reality
    // ========================================================

    if (
      isValidPort(
        REALITY_PORT
      )
    ) {

      generateOrLoadKeyPair();
    }


    // ========================================================
    // HY2 TLS
    // ========================================================

    if (
      isValidPort(
        HY2_PORT
      )
    ) {

      ensureTlsCertificates(
        certPath,
        keyPath
      );
    }


    // ========================================================
    // Xray 配置
    // ========================================================

    await generateConfig();


    // ========================================================
    // 下载并启动
    // ========================================================

    const started =
      await downloadFilesAndRun();


    if (!started) {

      console.error(
        'Proxy service startup failed.'
      );

      return;
    }


    // ========================================================
    // 获取 Argo
    // ========================================================

    const domainReady =
      await extractDomains();


    if (
      domainReady === false
    ) {

      console.error(
        'Failed to obtain Argo domain.'
      );

      return;
    }


    // ========================================================
    // Telegram
    // ========================================================

    await sendTelegram();


    // ========================================================
    // 自动访问
    // ========================================================

    await AddVisitTask();

  } catch (error) {

    console.error(
      'Error in startserver:',
      error
    );
  }
}


startserver().catch(
  error => {

    console.error(
      'Unhandled error in startserver:',
      error
    );

  }
);


// ============================================================
// HTTP 服务
// ============================================================

const server =
  http.createServer(
    async (req, res) => {

      const urlPath =
        req.url.split('?')[0];


      // ======================================================
      // 订阅
      // ======================================================

      if (
        urlPath === `/${SUB_PATH}`
      ) {

        if (
          subContent
        ) {

          res.writeHead(
            200,
            {
              'Content-Type':
                'text/plain; charset=utf-8'
            }
          );

          res.end(
            subContent
          );

        } else {

          try {

            const fileContent =
              fs.readFileSync(
                subPath,
                'utf-8'
              );


            res.writeHead(
              200,
              {
                'Content-Type':
                  'text/plain; charset=utf-8'
              }
            );


            res.end(
              fileContent
            );

          } catch {

            res.writeHead(
              503,
              {
                'Content-Type':
                  'text/plain; charset=utf-8'
              }
            );


            res.end(
              'Subscription content not yet available, please try again later.'
            );
          }
        }

        return;
      }


      // ======================================================
      // 根目录
      // ======================================================

      if (
        urlPath === '/'
      ) {

        try {

          const filePath =
            path.join(
              __dirname,
              'index.html'
            );


          const data =
            await fs.promises.readFile(
              filePath,
              'utf8'
            );


          res.writeHead(
            200,
            {
              'Content-Type':
                'text/html; charset=utf-8'
            }
          );


          res.end(
            data
          );

        } catch {

          res.writeHead(
            200,
            {
              'Content-Type':
                'text/html; charset=utf-8'
            }
          );


          res.end(
            `Hello world!<br><br>You can access /${SUB_PATH} to get your nodes!`
          );
        }

        return;
      }


      // ======================================================
      // 404
      // ======================================================

      res.writeHead(
        404,
        {
          'Content-Type':
            'text/plain; charset=utf-8'
        }
      );

      res.end(
        'Not Found'
      );
    }
  );


// ============================================================
// HTTP 服务
// ============================================================

server.listen(
  PORT,
  '0.0.0.0',
  () => {

    alwaysLog(
      `http server is running on ${PORT}!`
    );

  }
);
