//
//  PWVaultStore.m
//  密码卡包 V0.1 — AES-256-CBC + HMAC-SHA256 加密存储，密钥保存在 Keychain
//

#import "PWVaultStore.h"

#import <CommonCrypto/CommonCryptor.h>
#import <CommonCrypto/CommonDigest.h>
#import <CommonCrypto/CommonHMAC.h>
#import <CommonCrypto/CommonKeyDerivation.h>
#import <Security/Security.h>

static NSString *const kPWKeychainService = @"com.cxk.password.vault";
static NSString *const kPWKeychainAccount = @"master-key";
static NSString *const kPWPasscodeDefaultsKey = @"pw.passcode.v1";
static NSString *const kPWVaultFileName = @"vault.bin";

static const uint32_t kPWPBKDF2Rounds = 120000;
static const size_t kPWKeyLength = 32;

static const uint8_t kPWMagic[4] = {'P', 'W', 'V', '1'};

@implementation PWVaultStore {
    NSData *_masterKey;
    dispatch_queue_t _queue;
}

+ (instancetype)shared {
    static PWVaultStore *store = nil;
    static dispatch_once_t once;
    dispatch_once(&once, ^{ store = [[PWVaultStore alloc] init]; });
    return store;
}

- (instancetype)init {
    if ((self = [super init])) {
        _queue = dispatch_queue_create("com.cxk.password.vault", DISPATCH_QUEUE_SERIAL);
    }
    return self;
}

#pragma mark - 路径

- (NSString *)documentsPath {
    NSArray<NSString *> *dirs = NSSearchPathForDirectoriesInDomains(NSDocumentDirectory, NSUserDomainMask, YES);
    return dirs.firstObject ?: NSTemporaryDirectory();
}

- (NSString *)vaultPath {
    return [[self documentsPath] stringByAppendingPathComponent:kPWVaultFileName];
}

- (NSString *)fallbackKeyPath {
    return [[self documentsPath] stringByAppendingPathComponent:@".mk"];
}

#pragma mark - 主密钥

- (NSData *)randomBytes:(NSUInteger)count {
    NSMutableData *data = [NSMutableData dataWithLength:count];
    int status = SecRandomCopyBytes(kSecRandomDefault, count, data.mutableBytes);
    if (status != errSecSuccess) {
        uint8_t *ptr = (uint8_t *)data.mutableBytes;
        for (NSUInteger i = 0; i < count; i++) {
            ptr[i] = (uint8_t)(arc4random() & 0xFF);
        }
    }
    return data;
}

- (nullable NSData *)masterKey {
    @synchronized (self) {
        if (_masterKey) return _masterKey;

        // 1) Keychain
        NSDictionary *query = @{
            (__bridge id)kSecClass: (__bridge id)kSecClassGenericPassword,
            (__bridge id)kSecAttrService: kPWKeychainService,
            (__bridge id)kSecAttrAccount: kPWKeychainAccount,
            (__bridge id)kSecReturnData: @YES,
            (__bridge id)kSecMatchLimit: (__bridge id)kSecMatchLimitOne
        };
        CFTypeRef result = NULL;
        OSStatus status = SecItemCopyMatching((__bridge CFDictionaryRef)query, &result);
        if (status == errSecSuccess && result) {
            NSData *key = [(__bridge NSData *)result copy];
            CFRelease(result);
            if (key.length == kPWKeyLength) {
                _masterKey = key;
                return _masterKey;
            }
        }

        // 2) 文件兜底（重签名后的 App 可能没有 Keychain 访问组）
        NSData *stored = [NSData dataWithContentsOfFile:[self fallbackKeyPath]];
        if (stored.length == kPWKeyLength) {
            _masterKey = stored;
            return _masterKey;
        }

        // 3) 新建
        NSData *fresh = [self randomBytes:kPWKeyLength];
        NSDictionary *add = @{
            (__bridge id)kSecClass: (__bridge id)kSecClassGenericPassword,
            (__bridge id)kSecAttrService: kPWKeychainService,
            (__bridge id)kSecAttrAccount: kPWKeychainAccount,
            (__bridge id)kSecValueData: fresh,
            (__bridge id)kSecAttrAccessible: (__bridge id)kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        };
        OSStatus addStatus = SecItemAdd((__bridge CFDictionaryRef)add, NULL);
        if (addStatus != errSecSuccess) {
            [fresh writeToFile:[self fallbackKeyPath] atomically:YES];
            [[NSFileManager defaultManager] setAttributes:@{NSFileProtectionKey: NSFileProtectionComplete}
                                             ofItemAtPath:[self fallbackKeyPath]
                                                    error:NULL];
        }
        _masterKey = fresh;
        return _masterKey;
    }
}

#pragma mark - 加解密

- (NSData *)hmacKeyFromKey:(NSData *)key {
    const char *saltStr = "PWV1-mac";
    unsigned char out[CC_SHA256_DIGEST_LENGTH];
    CCHmac(kCCHmacAlgSHA256, saltStr, strlen(saltStr), key.bytes, key.length, out);
    return [NSData dataWithBytes:out length:sizeof(out)];
}

- (nullable NSData *)encrypt:(NSData *)plaintext key:(NSData *)key {
    NSData *iv = [self randomBytes:kCCBlockSizeAES128];
    size_t outLength = 0;
    size_t bufferSize = plaintext.length + kCCBlockSizeAES128;
    NSMutableData *buffer = [NSMutableData dataWithLength:bufferSize];
    CCCryptorStatus status = CCCrypt(kCCEncrypt,
                                     kCCAlgorithmAES,
                                     kCCOptionPKCS7Padding,
                                     key.bytes, key.length,
                                     iv.bytes,
                                     plaintext.bytes, plaintext.length,
                                     buffer.mutableBytes, bufferSize,
                                     &outLength);
    if (status != kCCSuccess) return nil;
    buffer.length = outLength;

    NSMutableData *payload = [NSMutableData data];
    [payload appendBytes:kPWMagic length:sizeof(kPWMagic)];
    [payload appendData:iv];
    [payload appendData:buffer];

    NSData *macKey = [self hmacKeyFromKey:key];
    unsigned char mac[CC_SHA256_DIGEST_LENGTH];
    CCHmac(kCCHmacAlgSHA256, macKey.bytes, macKey.length, payload.bytes, payload.length, mac);
    [payload appendBytes:mac length:sizeof(mac)];
    return payload;
}

- (nullable NSData *)decrypt:(NSData *)payload key:(NSData *)key {
    if (payload.length < sizeof(kPWMagic) + kCCBlockSizeAES128 + CC_SHA256_DIGEST_LENGTH) return nil;
    const uint8_t *bytes = payload.bytes;
    if (memcmp(bytes, kPWMagic, sizeof(kPWMagic)) != 0) return nil;

    NSUInteger bodyLength = payload.length - CC_SHA256_DIGEST_LENGTH;
    NSData *macKey = [self hmacKeyFromKey:key];
    unsigned char mac[CC_SHA256_DIGEST_LENGTH];
    CCHmac(kCCHmacAlgSHA256, macKey.bytes, macKey.length, payload.bytes, bodyLength, mac);

    const uint8_t *expected = bytes + bodyLength;
    uint8_t diff = 0;
    for (size_t i = 0; i < CC_SHA256_DIGEST_LENGTH; i++) diff |= (uint8_t)(mac[i] ^ expected[i]);
    if (diff != 0) return nil;

    NSData *iv = [payload subdataWithRange:NSMakeRange(sizeof(kPWMagic), kCCBlockSizeAES128)];
    NSData *cipher = [payload subdataWithRange:NSMakeRange(sizeof(kPWMagic) + kCCBlockSizeAES128,
                                                           bodyLength - sizeof(kPWMagic) - kCCBlockSizeAES128)];
    size_t outLength = 0;
    size_t bufferSize = cipher.length + kCCBlockSizeAES128;
    NSMutableData *buffer = [NSMutableData dataWithLength:bufferSize];
    CCCryptorStatus status = CCCrypt(kCCDecrypt,
                                     kCCAlgorithmAES,
                                     kCCOptionPKCS7Padding,
                                     key.bytes, key.length,
                                     iv.bytes,
                                     cipher.bytes, cipher.length,
                                     buffer.mutableBytes, bufferSize,
                                     &outLength);
    if (status != kCCSuccess) return nil;
    buffer.length = outLength;
    return buffer;
}

#pragma mark - 读写

- (nullable NSString *)loadDataString {
    __block NSString *result = nil;
    dispatch_sync(_queue, ^{
        NSData *payload = [NSData dataWithContentsOfFile:[self vaultPath]];
        if (!payload.length) return;
        NSData *key = [self masterKey];
        if (!key) return;
        NSData *plain = [self decrypt:payload key:key];
        if (!plain.length) return;
        result = [[NSString alloc] initWithData:plain encoding:NSUTF8StringEncoding];
    });
    return result;
}

- (BOOL)saveDataString:(NSString *)json error:(NSError **)error {
    if (!json) return NO;
    __block BOOL ok = NO;
    __block NSError *innerError = nil;
    dispatch_sync(_queue, ^{
        NSData *key = [self masterKey];
        if (!key) {
            innerError = [NSError errorWithDomain:@"PWVault" code:1
                                          userInfo:@{NSLocalizedDescriptionKey: @"master key unavailable"}];
            return;
        }
        NSData *plain = [json dataUsingEncoding:NSUTF8StringEncoding];
        NSData *payload = [self encrypt:plain key:key];
        if (!payload) {
            innerError = [NSError errorWithDomain:@"PWVault" code:2
                                          userInfo:@{NSLocalizedDescriptionKey: @"encrypt failed"}];
            return;
        }
        NSString *path = [self vaultPath];
        ok = [payload writeToFile:path options:NSDataWritingAtomic error:&innerError];
        if (ok) {
            [[NSFileManager defaultManager] setAttributes:@{NSFileProtectionKey: NSFileProtectionComplete}
                                             ofItemAtPath:path
                                                    error:NULL];
        }
    });
    if (!ok && error) *error = innerError;
    return ok;
}

#pragma mark - 主密码

- (nullable NSDictionary *)passcodeRecord {
    id obj = [[NSUserDefaults standardUserDefaults] objectForKey:kPWPasscodeDefaultsKey];
    return [obj isKindOfClass:[NSDictionary class]] ? obj : nil;
}

- (BOOL)hasPasscode {
    NSDictionary *record = [self passcodeRecord];
    return record[@"salt"] != nil && record[@"hash"] != nil;
}

- (NSData *)derivePasscode:(NSString *)code salt:(NSData *)salt rounds:(uint32_t)rounds {
    NSData *pwData = [code dataUsingEncoding:NSUTF8StringEncoding];
    unsigned char derived[kPWKeyLength];
    int status = CCKeyDerivationPBKDF(kCCPBKDF2,
                                      pwData.bytes, pwData.length,
                                      salt.bytes, salt.length,
                                      kCCPRFHmacAlgSHA256,
                                      rounds,
                                      derived, sizeof(derived));
    if (status != kCCSuccess) return nil;
    return [NSData dataWithBytes:derived length:sizeof(derived)];
}

- (BOOL)setPasscode:(NSString *)code {
    if (code.length < 4) return NO;
    NSData *salt = [self randomBytes:16];
    NSData *hash = [self derivePasscode:code salt:salt rounds:kPWPBKDF2Rounds];
    if (!hash) return NO;
    NSDictionary *record = @{
        @"salt": [salt base64EncodedStringWithOptions:0],
        @"hash": [hash base64EncodedStringWithOptions:0],
        @"rounds": @(kPWPBKDF2Rounds)
    };
    [[NSUserDefaults standardUserDefaults] setObject:record forKey:kPWPasscodeDefaultsKey];
    [[NSUserDefaults standardUserDefaults] synchronize];
    return YES;
}

- (BOOL)verifyPasscode:(NSString *)code {
    NSDictionary *record = [self passcodeRecord];
    if (!record) return NO;
    NSData *salt = [[NSData alloc] initWithBase64EncodedString:record[@"salt"] options:0];
    NSData *expected = [[NSData alloc] initWithBase64EncodedString:record[@"hash"] options:0];
    uint32_t rounds = [record[@"rounds"] unsignedIntValue];
    if (!salt.length || !expected.length) return NO;
    NSData *hash = [self derivePasscode:code salt:salt rounds:rounds ?: kPWPBKDF2Rounds];
    if (!hash || hash.length != expected.length) return NO;
    uint8_t diff = 0;
    const uint8_t *a = hash.bytes, *b = expected.bytes;
    for (NSUInteger i = 0; i < hash.length; i++) diff |= (uint8_t)(a[i] ^ b[i]);
    return diff == 0;
}

- (void)clearPasscode {
    [[NSUserDefaults standardUserDefaults] removeObjectForKey:kPWPasscodeDefaultsKey];
    [[NSUserDefaults standardUserDefaults] synchronize];
}

@end
