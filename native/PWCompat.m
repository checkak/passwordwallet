//
//  PWCompat.m
//  密码卡包 V0.1 — 兼容层
//  theos 提供的 iPhoneOS SDK 不含 compiler-rt 的 libclang_rt.ios.a，
//  clang 为 @available 生成的 __isPlatformVersionAtLeast 需要自备实现。
//

#import <Foundation/Foundation.h>

int __isPlatformVersionAtLeast(unsigned int platform,
                               unsigned int major,
                               unsigned int minor,
                               unsigned int patch) __attribute__((visibility("default")));

int __isPlatformVersionAtLeast(unsigned int platform,
                               unsigned int major,
                               unsigned int minor,
                               unsigned int patch) {
    NSOperatingSystemVersion v = [[NSProcessInfo processInfo] operatingSystemVersion];
    unsigned long long cur = (unsigned long long)v.majorVersion * 10000ULL +
                             (unsigned long long)v.minorVersion * 100ULL +
                             (unsigned long long)v.patchVersion;
    unsigned long long want = (unsigned long long)major * 10000ULL +
                              (unsigned long long)minor * 100ULL +
                              (unsigned long long)patch;
    (void)platform;
    return cur >= want;
}
