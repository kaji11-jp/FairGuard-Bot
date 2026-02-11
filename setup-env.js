const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const envPath = path.join(__dirname, '.env');
const examplePath = path.join(__dirname, 'env.example');

console.log('🔄 環境設定の確認中...');

if (!fs.existsSync(envPath)) {
    console.log('⚠️ .envファイルが見つかりません。env.exampleから作成します。');

    if (!fs.existsSync(examplePath)) {
        console.error('❌ env.exampleファイルも見つかりません。');
        process.exit(1);
    }

    let envContent = fs.readFileSync(examplePath, 'utf8');

    // 暗号化キーの生成
    const key = crypto.randomBytes(32).toString('hex');
    console.log('🔑 新しい暗号化キーを生成しました。');

    // キーの置換
    envContent = envContent.replace(
        /ENCRYPTION_KEY="YOUR_32_BYTE_HEX_ENCRYPTION_KEY_HERE"/,
        `ENCRYPTION_KEY="${key}"`
    );

    // その他のプレースホルダーへの警告（実際にはユーザーが設定する必要がある）
    console.warn('⚠️ 注意: .envファイルを作成しましたが、BOT_TOKEN等は手動で設定する必要があります。');

    fs.writeFileSync(envPath, envContent);
    console.log('✅ .envファイルを作成しました。');
} else {
    // 既存の.envファイルのチェック
    let envContent = fs.readFileSync(envPath, 'utf8');
    const keyMatch = envContent.match(/ENCRYPTION_KEY="([a-f0-9]{64})"/i);

    if (!keyMatch) {
        // キーがない、または形式が違う場合
        console.log('⚠️ .envファイルに有効な暗号化キーが見つかりません。');
        // ここで自動追記するか迷うが、既存ファイルを壊すリスクを避けて警告のみにするか、
        // 明確なプレースホルダーがあれば置換する。

        if (envContent.includes('ENCRYPTION_KEY="YOUR_32_BYTE_HEX_ENCRYPTION_KEY_HERE"')) {
            const key = crypto.randomBytes(32).toString('hex');
            envContent = envContent.replace(
                /ENCRYPTION_KEY="YOUR_32_BYTE_HEX_ENCRYPTION_KEY_HERE"/,
                `ENCRYPTION_KEY="${key}"`
            );
            fs.writeFileSync(envPath, envContent);
            console.log('✅ 暗号化キーを設定しました。');
        } else if (!envContent.includes('ENCRYPTION_KEY=')) {
            const key = crypto.randomBytes(32).toString('hex');
            fs.appendFileSync(envPath, `\nENCRYPTION_KEY="${key}"\n`);
            console.log('✅ 暗号化キーを追記しました。');
        } else {
            console.warn('⚠️ ENCRYPTION_KEYの設定行がありますが、形式が異なるか既に設定されている可能性があります。手動で確認してください。');
        }
    } else {
        console.log('✅ 環境設定は正常です。');
    }
}
