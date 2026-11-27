//
//  PWVaultStore.h
//  密码卡包 V0.1 — 本地加密存储
//

#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

@interface PWVaultStore : NSObject

+ (instancetype)shared;

/// 读取解密后的 JSON 字符串，没有数据时返回 nil
- (nullable NSString *)loadDataString;

/// 加密并落盘
- (BOOL)saveDataString:(NSString *)json error:(NSError **)error;

/// 主密码（仅作为解锁闸门，PBKDF2-SHA256 存储）
- (BOOL)hasPasscode;
- (BOOL)setPasscode:(NSString *)code;
- (BOOL)verifyPasscode:(NSString *)code;
- (void)clearPasscode;

@end

NS_ASSUME_NONNULL_END
