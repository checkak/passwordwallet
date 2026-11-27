//
//  PWRootViewController.m
//  密码卡包 V0.1 — WKWebView 原生壳 + JS 桥（存储 / 剪贴板 / 触感 / 分享）
//

#import <UIKit/UIKit.h>
#import <WebKit/WebKit.h>

#import "PWVaultStore.h"

@interface PWRootViewController : UIViewController <WKScriptMessageHandler, WKNavigationDelegate>
@end

@implementation PWRootViewController {
    WKWebView *_webView;
    dispatch_queue_t _workQueue;
    NSString *_lastSensitiveClipboard;
}

- (void)loadView {
    UIView *view = [[UIView alloc] initWithFrame:[[UIScreen mainScreen] bounds]];
    view.backgroundColor = [UIColor colorWithRed:0.949 green:0.957 blue:0.976 alpha:1.0];
    self.view = view;
}

- (UIStatusBarStyle)preferredStatusBarStyle {
    if (@available(iOS 13.0, *)) {
        return UIStatusBarStyleDarkContent;
    }
    return UIStatusBarStyleDefault;
}

- (void)viewDidLoad {
    [super viewDidLoad];
    _workQueue = dispatch_queue_create("com.cxk.password.bridge", DISPATCH_QUEUE_SERIAL);

    WKWebViewConfiguration *config = [[WKWebViewConfiguration alloc] init];
    config.allowsInlineMediaPlayback = YES;
    config.mediaTypesRequiringUserActionForPlayback = WKAudiovisualMediaTypeAll;
    [config.userContentController addScriptMessageHandler:self name:@"vaultBridge"];

    WKWebView *webView = [[WKWebView alloc] initWithFrame:self.view.bounds configuration:config];
    webView.autoresizingMask = UIViewAutoresizingFlexibleWidth | UIViewAutoresizingFlexibleHeight;
    webView.navigationDelegate = self;
    webView.allowsLinkPreview = NO;
    webView.opaque = NO;
    webView.backgroundColor = [UIColor clearColor];
    webView.scrollView.backgroundColor = [UIColor clearColor];
    webView.scrollView.bounces = NO;
    webView.scrollView.showsVerticalScrollIndicator = NO;
    webView.scrollView.contentInsetAdjustmentBehavior = UIScrollViewContentInsetAdjustmentNever;
    [self.view addSubview:webView];
    _webView = webView;

    NSURL *url = [[NSBundle mainBundle] URLForResource:@"index" withExtension:@"html" subdirectory:@"web"];
    if (!url) {
        NSLog(@"[PW] web/index.html 缺失");
        return;
    }
    [webView loadFileURL:url allowingReadAccessToURL:[url URLByDeletingLastPathComponent]];

    NSNotificationCenter *center = [NSNotificationCenter defaultCenter];
    [center addObserver:self selector:@selector(handleBackground)
                   name:UIApplicationDidEnterBackgroundNotification object:nil];
    [center addObserver:self selector:@selector(handleForeground)
                   name:UIApplicationWillEnterForegroundNotification object:nil];
}

- (void)dealloc {
    [[NSNotificationCenter defaultCenter] removeObserver:self];
    [_webView.configuration.userContentController removeScriptMessageHandlerForName:@"vaultBridge"];
}

#pragma mark - 生命周期事件

- (void)handleBackground {
    [self evaluate:@"window.__appEvent && window.__appEvent('background')"];
}

- (void)handleForeground {
    [self evaluate:@"window.__appEvent && window.__appEvent('foreground')"];
}

#pragma mark - JS 执行 / 回复

- (void)evaluate:(NSString *)js {
    dispatch_async(dispatch_get_main_queue(), ^{
        [self->_webView evaluateJavaScript:js completionHandler:nil];
    });
}

- (void)reply:(id)msgId payload:(NSDictionary *)payload {
    NSArray *envelope = @[msgId ?: [NSNull null], payload ?: @{}];
    NSError *error = nil;
    NSData *data = [NSJSONSerialization dataWithJSONObject:envelope options:0 error:&error];
    if (!data) return;
    NSString *json = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
    NSString *js = [NSString stringWithFormat:@"window.__bridgeReply && window.__bridgeReply.apply(null, %@);", json];
    dispatch_async(dispatch_get_main_queue(), ^{
        [self->_webView evaluateJavaScript:js completionHandler:nil];
    });
}

- (void)replyOK:(id)msgId result:(NSDictionary *)result {
    [self reply:msgId payload:@{@"ok": @YES, @"result": result ?: @{}}];
}

- (void)replyError:(id)msgId message:(NSString *)message {
    [self reply:msgId payload:@{@"ok": @NO, @"error": message ?: @"error"}];
}

#pragma mark - 桥接入口

- (void)userContentController:(WKUserContentController *)userContentController
      didReceiveScriptMessage:(WKScriptMessage *)message {
    if (![message.body isKindOfClass:[NSDictionary class]]) return;
    NSDictionary *body = (NSDictionary *)message.body;
    id msgId = body[@"id"];
    NSString *method = body[@"method"];
    NSDictionary *params = [body[@"params"] isKindOfClass:[NSDictionary class]] ? body[@"params"] : @{};
    if (![method isKindOfClass:[NSString class]]) return;

    PWVaultStore *store = [PWVaultStore shared];

    if ([method isEqualToString:@"vault.load"]) {
        dispatch_async(_workQueue, ^{
            NSString *json = [store loadDataString];
            [self replyOK:msgId result:json ? @{@"data": json} : @{}];
        });
        return;
    }

    if ([method isEqualToString:@"vault.save"]) {
        NSString *json = params[@"data"];
        if (![json isKindOfClass:[NSString class]]) { [self replyError:msgId message:@"bad data"]; return; }
        dispatch_async(_workQueue, ^{
            NSError *error = nil;
            BOOL ok = [store saveDataString:json error:&error];
            if (ok) [self replyOK:msgId result:@{@"saved": @YES}];
            else [self replyError:msgId message:error.localizedDescription ?: @"save failed"];
        });
        return;
    }

    if ([method isEqualToString:@"passcode.has"]) {
        dispatch_async(_workQueue, ^{
            [self replyOK:msgId result:@{@"has": @([store hasPasscode])}];
        });
        return;
    }

    if ([method isEqualToString:@"passcode.set"]) {
        NSString *code = params[@"passcode"];
        if (![code isKindOfClass:[NSString class]]) { [self replyError:msgId message:@"bad passcode"]; return; }
        dispatch_async(_workQueue, ^{
            BOOL ok = [store setPasscode:code];
            if (ok) [self replyOK:msgId result:@{@"set": @YES}];
            else [self replyError:msgId message:@"passcode too short"];
        });
        return;
    }

    if ([method isEqualToString:@"passcode.verify"]) {
        NSString *code = params[@"passcode"];
        if (![code isKindOfClass:[NSString class]]) { [self replyError:msgId message:@"bad passcode"]; return; }
        dispatch_async(_workQueue, ^{
            [self replyOK:msgId result:@{@"ok": @([store verifyPasscode:code])}];
        });
        return;
    }

    if ([method isEqualToString:@"passcode.clear"]) {
        dispatch_async(_workQueue, ^{
            [store clearPasscode];
            [self replyOK:msgId result:@{}];
        });
        return;
    }

    if ([method isEqualToString:@"clipboard.copy"]) {
        NSString *text = params[@"text"];
        BOOL sensitive = [params[@"sensitive"] boolValue];
        if (![text isKindOfClass:[NSString class]]) { [self replyError:msgId message:@"bad text"]; return; }
        dispatch_async(dispatch_get_main_queue(), ^{
            [UIPasteboard generalPasteboard].string = text;
            if (sensitive) {
                self->_lastSensitiveClipboard = [text copy];
                NSString *snapshot = [text copy];
                dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(60 * NSEC_PER_SEC)),
                               dispatch_get_main_queue(), ^{
                    if ([UIPasteboard generalPasteboard].string &&
                        [[UIPasteboard generalPasteboard].string isEqualToString:snapshot]) {
                        [UIPasteboard generalPasteboard].string = @"";
                    }
                });
            }
            [self replyOK:msgId result:@{@"copied": @YES}];
        });
        return;
    }

    if ([method isEqualToString:@"clipboard.read"]) {
        dispatch_async(dispatch_get_main_queue(), ^{
            NSString *text = [UIPasteboard generalPasteboard].string;
            [self replyOK:msgId result:text ? @{@"text": text} : @{}];
        });
        return;
    }

    if ([method isEqualToString:@"haptic"]) {
        NSString *type = params[@"type"];
        dispatch_async(dispatch_get_main_queue(), ^{
            if ([type isEqualToString:@"heavy"]) {
                UIImpactFeedbackGenerator *g = [[UIImpactFeedbackGenerator alloc] initWithStyle:UIImpactFeedbackStyleHeavy];
                [g impactOccurred];
            } else if ([type isEqualToString:@"medium"]) {
                UIImpactFeedbackGenerator *g = [[UIImpactFeedbackGenerator alloc] initWithStyle:UIImpactFeedbackStyleMedium];
                [g impactOccurred];
            } else {
                UIImpactFeedbackGenerator *g = [[UIImpactFeedbackGenerator alloc] initWithStyle:UIImpactFeedbackStyleLight];
                [g impactOccurred];
            }
            [self replyOK:msgId result:@{}];
        });
        return;
    }

    if ([method isEqualToString:@"share.text"]) {
        NSString *text = params[@"text"];
        NSString *filename = params[@"filename"];
        if (![text isKindOfClass:[NSString class]]) { [self replyError:msgId message:@"bad text"]; return; }
        dispatch_async(dispatch_get_main_queue(), ^{
            NSString *name = [filename isKindOfClass:[NSString class]] ? filename : @"share.txt";
            NSString *path = [NSTemporaryDirectory() stringByAppendingPathComponent:name];
            [text writeToFile:path atomically:YES encoding:NSUTF8StringEncoding error:NULL];
            NSURL *fileURL = [NSURL fileURLWithPath:path];
            UIActivityViewController *vc = [[UIActivityViewController alloc] initWithActivityItems:@[fileURL]
                                                                            applicationActivities:nil];
            if (vc.popoverPresentationController) {
                vc.popoverPresentationController.sourceView = self.view;
                vc.popoverPresentationController.sourceRect = CGRectMake(CGRectGetMidX(self.view.bounds),
                                                                        CGRectGetMaxY(self.view.bounds) - 40, 1, 1);
            }
            [self presentViewController:vc animated:YES completion:^{
                [self replyOK:msgId result:@{@"presented": @YES}];
            }];
        });
        return;
    }

    if ([method isEqualToString:@"http.get"]) {
        NSString *urlString = params[@"url"];
        if (![urlString isKindOfClass:[NSString class]]) { [self replyError:msgId message:@"bad url"]; return; }
        NSURL *url = [NSURL URLWithString:urlString];
        if (!url) { [self replyError:msgId message:@"bad url"]; return; }
        NSMutableURLRequest *request = [NSMutableURLRequest requestWithURL:url];
        request.timeoutInterval = 6;
        request.cachePolicy = NSURLRequestReloadIgnoringLocalCacheData;
        [request setValue:@"application/json" forHTTPHeaderField:@"Accept"];
        [request setValue:@"application/vnd.github+json" forHTTPHeaderField:@"Accept-GitHub"];
        [request setValue:@"2022-11-28" forHTTPHeaderField:@"X-GitHub-Api-Version"];
        [request setValue:@"PasswordWallet/1.2 (iOS)" forHTTPHeaderField:@"User-Agent"];
        NSURLSessionDataTask *task = [[NSURLSession sharedSession] dataTaskWithRequest:request
            completionHandler:^(NSData *data, NSURLResponse *response, NSError *error) {
            if (error || !data) {
                [self replyError:msgId message:(error.localizedDescription ?: @"network error")];
                return;
            }
            NSInteger status = 0;
            if ([response isKindOfClass:[NSHTTPURLResponse class]]) {
                status = [(NSHTTPURLResponse *)response statusCode];
            }
            NSString *body = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding] ?: @"";
            [self replyOK:msgId result:@{@"status": @(status), @"body": body}];
        }];
        [task resume];
        return;
    }

    if ([method isEqualToString:@"app.info"]) {
        NSDictionary *info = [[NSBundle mainBundle] infoDictionary];
        NSString *version = info[@"CFBundleShortVersionString"] ?: @"0.1";
        NSString *build = info[@"CFBundleVersion"] ?: @"1";
        [self replyOK:msgId result:@{@"version": version, @"build": build}];
        return;
    }

    [self replyError:msgId message:[NSString stringWithFormat:@"unknown method %@", method]];
}

#pragma mark - WKNavigationDelegate

- (void)webView:(WKWebView *)webView didFinishNavigation:(WKNavigation *)navigation {
    NSLog(@"[PW] web 加载完成");
}

- (void)webViewWebProcessDidTerminate:(WKWebView *)webView {
    NSURL *url = [[NSBundle mainBundle] URLForResource:@"index" withExtension:@"html" subdirectory:@"web"];
    if (url) [webView loadFileURL:url allowingReadAccessToURL:[url URLByDeletingLastPathComponent]];
}

@end
