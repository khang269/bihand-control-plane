import React, { useState, useEffect } from 'react';
import { useLanguage } from '../context/LanguageContext';
import { useLocation } from 'react-router-dom';
import { BookOpen, ShieldCheck, CreditCard, HelpCircle } from 'lucide-react';
import { PublicHeader } from '../components/public/PublicHeader';
import { cn } from '../lib/cn';

type Tab = 'terms' | 'usage' | 'payment' | 'faq';

const tabs: { id: Tab; icon: React.ElementType; en: string; vi: string }[] = [
  { id: 'terms', icon: BookOpen, en: 'General Terms', vi: 'Điều Khoản Chung' },
  { id: 'usage', icon: ShieldCheck, en: 'Terms of Use', vi: 'Điều Khoản Giao Dịch' },
  { id: 'payment', icon: CreditCard, en: 'Payment Policy', vi: 'Chính Sách Thanh Toán' },
  { id: 'faq', icon: HelpCircle, en: 'FAQs', vi: 'Câu Hỏi Thường Gặp' },
];

const Terms: React.FC = () => {
  const { language } = useLanguage();
  const location = useLocation();

  const getInitialTab = (): Tab => {
    const hash = location.hash.replace('#', '');
    if (hash === 'terms' || hash === 'usage' || hash === 'payment' || hash === 'faq') {
      return hash;
    }
    const params = new URLSearchParams(location.search);
    const tab = params.get('tab');
    if (tab === 'terms' || tab === 'usage' || tab === 'payment' || tab === 'faq') {
      return tab;
    }
    return 'terms';
  };

  const [activeSection, setActiveTab] = useState<Tab>(getInitialTab());

  useEffect(() => {
    const hash = location.hash.replace('#', '');
    if (hash === 'terms' || hash === 'usage' || hash === 'payment' || hash === 'faq') {
      setActiveTab(hash);
    } else {
      const params = new URLSearchParams(location.search);
      const tab = params.get('tab');
      if (tab === 'terms' || tab === 'usage' || tab === 'payment' || tab === 'faq') {
        setActiveTab(tab as Tab);
      }
    }
  }, [location]);

  return (
    <div className="min-h-screen bg-background text-foreground font-sans selection:bg-primary selection:text-primary-foreground">
      <PublicHeader cta="back" />

      <div className="max-w-6xl mx-auto px-6 py-12 space-y-8">
        {/* Segmented pill tab control */}
        <div className="flex flex-wrap gap-1.5 bg-secondary border border-border rounded-full p-1.5 w-fit mx-auto lg:mx-0">
          {tabs.map(({ id, icon: Icon, en, vi }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={cn(
                'flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold transition-all',
                activeSection === id
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <Icon size={16} /> {language === 'en' ? en : vi}
            </button>
          ))}
        </div>

        {/* Main Legal Content */}
        <main className="border border-border rounded-2xl bg-card p-8 md:p-12 text-left">
          {activeSection === 'terms' && (
            language === 'en' ? (
              <article className="space-y-6">
                <h1 className="text-3xl font-extrabold tracking-tight mb-2">General Terms & Conditions</h1>
                <p className="text-xs text-muted-foreground font-mono">LAST UPDATED: JUNE 6, 2026 &middot; REF: BIHAND-TOS-V2</p>

                <p className="text-sm text-foreground/90 leading-relaxed">
                  Welcome to <strong>Bihand</strong>, owned and operated by <strong>Graphicsminer</strong> (referred to as "Bihand", "we", "us", or "our"). These General Terms & Conditions govern your access to and use of our corporate AI agent orchestration control plane, our websites, APIs, and virtual machine setups. Please read these terms carefully before deploying any agent VM fleets.
                </p>

                <section className="space-y-3 pt-4">
                  <h3 className="text-lg font-bold">1. Agreement and Representation</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    By accessing the Service, you represent that you are at least 18 years of age and hold the legal authority to bind your organization or corporate entity. Registration requires a verified email address, a secure password setup, and explicit acceptance of this agreement. Bihand reserves the right to deny service or terminate accounts failing to satisfy standard KYC/compliance verifications.
                  </p>
                </section>

                <section className="space-y-3">
                  <h3 className="text-lg font-bold">2. Infrastructure & Compute Workspace Allocation</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    Bihand provides high-availability cloud orchestration, provisioning isolated sandboxed virtual machines (VMs) on Google Cloud Platform (GCP) running our supported strategy runtimes (OpenClaw, OpenCode, ClaudeCode). All compute, memory, and SSD storage capacities are allocated dynamically per your active roster configurations. Bihand does not guarantee uninterrupted runtime availability in cases of upstream GCP regional hypervisor outages or network connectivity issues.
                  </p>
                </section>

                <section className="space-y-3">
                  <h3 className="text-lg font-bold">3. Intellectual Property Rights</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    The Bihand platform code, design patterns, UI configurations, branding, and proprietary background orchestration engines are the exclusive intellectual property of <strong>Graphicsminer</strong>. All code, files, assets, databases, and digital artifacts generated inside your private GCP VM workspace remain 100% your exclusive property.
                  </p>
                </section>

                <section className="space-y-3">
                  <h3 className="text-lg font-bold">4. Limitation of Liability</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    Bihand is an infrastructure coordination and execution plane. We are not liable for any financial losses, service disruptions, or direct/indirect damages arising from the autonomous actions, code compilation, database deletions, or social media postings executed by your deployed AI agent fleets. Users must configure proper security guardrails and budget caps.
                  </p>
                </section>
              </article>
            ) : (
              <article className="space-y-6">
                <h1 className="text-3xl font-extrabold tracking-tight mb-2">Điều Khoản Chung</h1>
                <p className="text-xs text-muted-foreground font-mono">CẬP NHẬT LẦN CUỐI: NGÀY 6 THÁNG 6 NĂM 2026 &middot; REF: BIHAND-TOS-V2</p>

                <p className="text-sm text-foreground/90 leading-relaxed">
                  Chào mừng bạn đến với <strong>Bihand</strong>, được sở hữu và vận hành bởi <strong>Graphicsminer</strong> ("Bihand", "chúng tôi" hoặc "của chúng tôi"). Điều Khoản và Điều Kiện Chung này điều chỉnh việc bạn truy cập và sử dụng bảng điều khiển tác nhân AI tự trị Bihand, các trang web, API và cấu hình máy ảo của chúng tôi. Vui lòng đọc kỹ các điều khoản này trước khi khởi chạy hạm đội tác nhân AI.
                </p>

                <section className="space-y-3 pt-4">
                  <h3 className="text-lg font-bold">1. Thỏa Thuận và Đại Diện Pháp Lý</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    Bằng việc sử dụng Dịch vụ, bạn cam kết rằng bạn đã đủ 18 tuổi và có đầy đủ quyền hạn pháp lý để ràng buộc tổ chức hoặc pháp nhân của mình với thỏa thuận này. Đăng ký tài khoản yêu cầu địa chỉ email đã xác minh, thiết lập mật khẩu an toàn và chấp thuận rõ ràng các điều khoản này. Bihand có quyền từ chối cung cấp dịch vụ hoặc chấm dứt tài khoản nếu không đáp ứng các tiêu chuẩn tuân thủ cần thiết.
                  </p>
                </section>

                <section className="space-y-3">
                  <h3 className="text-lg font-bold">2. Phân Bổ Không Gian Lưu Trữ & Máy Ảo</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    Bihand cung cấp cơ chế điều phối đám mây có độ sẵn sàng cao, khởi tạo các máy ảo (VM) cô lập trên nền tảng Google Cloud Platform (GCP) chạy các cấu hình tác nhân được hỗ trợ (OpenClaw, OpenCode, ClaudeCode). Toàn bộ năng lực tính toán, RAM và bộ nhớ SSD được cấp phát động dựa trên cấu hình nhân sự hằng tháng của bạn. Bihand không cam kết tính liên tục tuyệt đối trong trường hợp xảy ra sự cố phần cứng tại khu vực của GCP hoặc mất kết nối mạng toàn cầu.
                  </p>
                </section>

                <section className="space-y-3">
                  <h3 className="text-lg font-bold">3. Quyền Sở Hữu Trí Tuệ</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    Mã nguồn nền tảng Bihand, thiết kế giao diện, cấu trúc điều phối, thương hiệu và các công cụ giám sát chạy ngầm thuộc quyền sở hữu trí tuệ độc quyền của <strong>Graphicsminer</strong>. Toàn bộ mã nguồn, tệp tin, cơ sở dữ liệu và các sản phẩm số được tạo ra bên trong không gian máy ảo GCP riêng tư của bạn hoàn toàn thuộc quyền sở hữu 100% của riêng bạn.
                  </p>
                </section>

                <section className="space-y-3">
                  <h3 className="text-lg font-bold">4. Giới Hạn Trách Nhiệm Pháp Lý</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    Bihand đóng vai trò là một lớp cơ sở hạ tầng điều phối và thực thi. Chúng tôi hoàn toàn không chịu trách nhiệm pháp lý đối với bất kỳ tổn thất tài chính, gián đoạn dịch vụ hoặc thiệt hại trực tiếp/gián tiếp nào phát sinh từ các hành động tự trị, biên dịch mã nguồn, xóa cơ sở dữ liệu hoặc bài đăng mạng xã hội được thực hiện bởi hạm đội tác nhân AI của bạn. Người dùng có trách nhiệm tự thiết lập các giới hạn ngân sách và rào cản bảo mật phù hợp.
                  </p>
                </section>
              </article>
            )
          )}

          {activeSection === 'usage' && (
            language === 'en' ? (
              <article className="space-y-6">
                <h1 className="text-3xl font-extrabold tracking-tight mb-2">Terms of Use & Fair Transaction</h1>
                <p className="text-xs text-muted-foreground font-mono">LAST UPDATED: JUNE 6, 2026 &middot; REF: BIHAND-TOU-V2</p>

                <section className="space-y-3">
                  <h3 className="text-lg font-bold">1. Permitted Uses and Workspace Guardrails</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    All provisioned VM workspaces are designed for secure, autonomous work. Any form of infrastructure abuse, including but not limited to: cryptocurrency mining, port scanning, hosting illegal files, launching DDoS attacks, mass automated spamming, or hosting unprivileged proxies, is strictly prohibited. Your isolated workspace is actively monitored by our infrastructure metrics agent for network and CPU anomalies.
                  </p>
                </section>

                <section className="space-y-3">
                  <h3 className="text-lg font-bold">2. Wallet Balance & Verification</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    The user must maintain a non-zero credit balance in their central Bihand wallet to sustain active agent runtimes. Credits are deducted continuously according to the selected VM performance configurations. If your balance drops to 0, all running VMs will be automatically suspended. Data on persistent disks will be retained for up to 14 days before permanent reclamation and purging.
                  </p>
                </section>

                <section className="space-y-3">
                  <h3 className="text-lg font-bold">3. Security of Credentials & Tokens</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    All integration credentials, cloud providers API keys, and workspace connection parameters are stored locally on our databases using explicit Client-Side Field Level Encryption (CSFLE) with AES-256-CBC. Users are entirely responsible for protecting their master dashboard credentials and private keys. Bihand will never request your private master passwords.
                  </p>
                </section>
              </article>
            ) : (
              <article className="space-y-6">
                <h1 className="text-3xl font-extrabold tracking-tight mb-2">Điều Khoản Giao Dịch</h1>
                <p className="text-xs text-muted-foreground font-mono">CẬP NHẬT LẦN CUỐI: NGÀY 6 THÁNG 6 NĂM 2026 &middot; REF: BIHAND-TOU-V2</p>

                <section className="space-y-3">
                  <h3 className="text-lg font-bold">1. Phạm Vi Sử Dụng & Rào Cản Không Gian Làm Việc</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    Tất cả các máy ảo được cấp phát được thiết kế cho các tác vụ công việc tự trị, hợp lệ. Mọi hành vi lạm dụng cơ sở hạ tầng, bao gồm nhưng không giới hạn ở: khai thác tiền mã hóa, quét cổng bảo mật, lưu trữ tệp tin trái phép, tấn công từ chối dịch vụ (DDoS), spam tin nhắn hàng loạt hoặc vận hành các proxy không được phép, đều bị nghiêm cấm. Không gian làm việc cô lập của bạn được giám sát liên tục bởi các công cụ đo lường tài nguyên phần cứng để phát hiện các bất thường về mạng và CPU.
                  </p>
                </section>

                <section className="space-y-3">
                  <h3 className="text-lg font-bold">2. Số Dư Wallet & Xác Minh Thanh Toán</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    Người dùng cần duy trì số dư hạn mức lớn hơn 0 trong ví Bihand trung tâm để duy trì hoạt động cho các tác nhân AI. Hạn mức sẽ được khấu trừ liên tục theo cấu hình máy ảo đã chọn. Nếu số dư tài khoản về 0, toàn bộ máy ảo đang chạy sẽ tự động bị tạm dừng. Dữ liệu trên ổ đĩa SSD sẽ được giữ lại tối đa 14 ngày trước khi bị thu hồi và xóa vĩnh viễn khỏi đám mây.
                  </p>
                </section>

                <section className="space-y-3">
                  <h3 className="text-lg font-bold">3. Bảo Mật Thông Tin Đăng Nhập & Khóa</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    Tất cả thông tin đăng nhập tích hợp bên thứ ba, khóa API của nhà cung cấp mô hình và tham số kết nối được lưu trữ bảo mật trên cơ sở dữ liệu của chúng tôi bằng giải pháp mã hóa phía máy khách MongoDB (CSFLE) chuẩn AES-256-CBC. Người dùng hoàn toàn tự chịu trách nhiệm bảo vệ mật khẩu tổng của bảng điều khiển. Bihand sẽ không bao giờ yêu cầu bạn cung cấp mật khẩu tổng dưới bất kỳ hình thức nào.
                  </p>
                </section>
              </article>
            )
          )}

          {activeSection === 'payment' && (
            language === 'en' ? (
              <article className="space-y-6">
                <h1 className="text-3xl font-extrabold tracking-tight mb-2">Chính Sách Thanh Toán & Refunds</h1>
                <p className="text-xs text-muted-foreground font-mono">LAST UPDATED: JUNE 6, 2026 &middot; REF: BIHAND-PAY-V2</p>

                <p className="text-sm text-foreground/90 leading-relaxed">
                  Bihand utilizes a transparent, granular utility-billing scale based on credit purchases. All payments are processed securely through **Stripe** or authorized regional VNPAY gateways.
                </p>

                <section className="space-y-3 pt-4">
                  <h3 className="text-lg font-bold">1. Purchase Rate & Credit Worth</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    We offer three curated packages matching different budget tiers. Credits represent real purchasing power at the rate of **1 Credit = $0.01 USD** ($1.00 USD = 100 Credits). Purchased credits are immediately deposited into your account wallet upon payment confirmation and do not expire as long as your account remains active.
                  </p>
                </section>

                <section className="space-y-3">
                  <h3 className="text-lg font-bold">2. Automatic Watchdog Refunds</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    Bihand prioritizes transaction fairness. If a VM deployment fails during the initialization or installing steps, or if the worker container crashes before completing the setup, our background watchdog daemon (`reconcile_system_state_task`) automatically detects the failure, terminates the orphaned resources, and **refunds 100% of the deducted credits back to your wallet** within 15 minutes.
                  </p>
                </section>

                <section className="space-y-3">
                  <h3 className="text-lg font-bold">3. Refund Exclusions</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    Refunds are only issued for platform-level deployment failures, hypervisor crashes, or internal worker loss events. No refunds will be provided for:
                    <br />&bull; Agent logic errors, rate-limiting, or task blockages arising from the user's custom system prompts.
                    <br />&bull; Outages due to incorrect or expired third-party API keys provided during setup.
                    <br />&bull; Accidental workspace file deletions performed by your own automated developer agents.
                  </p>
                </section>
              </article>
            ) : (
              <article className="space-y-6">
                <h1 className="text-3xl font-extrabold tracking-tight mb-2">Chính Sách Thanh Toán</h1>
                <p className="text-xs text-muted-foreground font-mono">CẬP NHẬT LẦN CUỐI: NGÀY 6 THÁNG 6 NĂM 2026 &middot; REF: BIHAND-PAY-V2</p>

                <p className="text-sm text-foreground/90 leading-relaxed">
                  Bihand áp dụng cơ chế thanh toán minh bạch, chi tiết dựa trên việc nạp hạn mức (credits). Mọi giao dịch thanh toán được xử lý an toàn thông qua cổng thanh toán **Stripe** hoặc VNPAY được ủy quyền.
                </p>

                <section className="space-y-3 pt-4">
                  <h3 className="text-lg font-bold">1. Tỷ Lệ Quy Đổi Hạn Mức</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    Chúng tôi cung cấp ba gói cước phù hợp với các quy mô ngân sách khác nhau. Hạn mức đại diện cho giá trị thanh toán thực tế với tỷ lệ quy đổi **1 Credit = $0.01 USD** ($1.00 USD = 100 Credits). Hạn mức đã mua sẽ được ghi nhận ngay lập tức vào ví tài khoản của bạn sau khi có xác nhận thanh toán thành công và không giới hạn thời gian sử dụng khi tài khoản hoạt động.
                  </p>
                </section>

                <section className="space-y-3">
                  <h3 className="text-lg font-bold">2. Cơ Chế Hoàn Tiền Tự Động Từ Giám Sát</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    Bihand đặt tính công bằng của các giao dịch lên hàng đầu. Nếu quá trình khởi tạo máy ảo bị lỗi ở bước thiết lập ban đầu, hoặc nếu container xử lý gặp sự cố trước khi hoàn tất cài đặt, tiến trình giám sát chạy ngầm (`reconcile_system_state_task`) sẽ tự động phát hiện lỗi, xóa các tài nguyên rác liên quan và **hoàn lại 100% số hạn mức đã khấu trừ về ví tài khoản của bạn** trong vòng 15 phút.
                  </p>
                </section>

                <section className="space-y-3">
                  <h3 className="text-lg font-bold">3. Các Trường Hợp Loại Trừ Hoàn Tiền</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    Việc hoàn tiền chỉ được áp dụng cho các lỗi từ phía nền tảng Bihand, sự cố máy chủ GCP hoặc lỗi từ hệ thống trung tâm. Chúng tôi sẽ từ chối hoàn tiền đối với:
                    <br />&bull; Lỗi logic của tác nhân AI, lỗi giới hạn cuộc gọi (rate-limiting) hoặc tắc nghẽn công việc do prompt hệ thống tùy chỉnh của bạn.
                    <br />&bull; Sự cố dừng hoạt động do bạn nhập sai hoặc hết hạn khóa API của bên thứ ba trong quá trình thiết lập.
                    <br />&bull; Vô tình xóa các tệp tin trong không gian làm việc do tác nhân nhà phát triển tự động của chính bạn thực hiện.
                  </p>
                </section>
              </article>
            )
          )}

          {activeSection === 'faq' && (
            language === 'en' ? (
              <article className="space-y-6">
                <h1 className="text-3xl font-extrabold tracking-tight mb-2">Frequently Asked Questions (FAQs)</h1>
                <p className="text-xs text-muted-foreground font-mono">REF: BIHAND-FAQ-V2</p>

                <div className="space-y-4 pt-4">
                  <div className="border border-border rounded-xl p-4 bg-secondary/50">
                    <h4 className="font-bold mb-1.5">Q: What is the minimum machine type required for agents?</h4>
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      A: To ensure highly predictable running environments and prevent out-of-memory errors during large browser crawls or compilations, we removed the legacy `e2-micro` instances. The minimum required VM is now **`e2-small`** (2 vCPUs, 2GB RAM) priced at 100 credits ($1.00 USD) per day.
                    </p>
                  </div>

                  <div className="border border-border rounded-xl p-4 bg-secondary/50">
                    <h4 className="font-bold mb-1.5">Q: How does the Google Workspace integration function securely?</h4>
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      A: We request secure, isolated OAuth access tokens from your Google Account. These tokens are saved locally in the database using explicit CSFLE and synchronized on creation directly inside your private VM. The pre-installed `gog` CLI reads these credentials to perform actions without accessing or copying your private data to our master server.
                    </p>
                  </div>

                  <div className="border border-border rounded-xl p-4 bg-secondary/50">
                    <h4 className="font-bold mb-1.5">Q: Can I run custom models on my agents?</h4>
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      A: Yes! Our wizard supports custom text input fallbacks. Simply select "Custom Model..." inside the lineup builder, type your model name (e.g. `gemini-2.5-flash` or `gpt-4o-mini`), and link your verified credentials to begin.
                    </p>
                  </div>
                </div>
              </article>
            ) : (
              <article className="space-y-6">
                <h1 className="text-3xl font-extrabold tracking-tight mb-2">Câu Hỏi Thường Gặp (FAQs)</h1>
                <p className="text-xs text-muted-foreground font-mono">REF: BIHAND-FAQ-V2</p>

                <div className="space-y-4 pt-4">
                  <div className="border border-border rounded-xl p-4 bg-secondary/50">
                    <h4 className="font-bold mb-1.5">H: Cấu hình tối thiểu yêu cầu cho mỗi máy ảo tác nhân là gì?</h4>
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      T: Để đảm bảo môi trường máy ảo chạy dự đoán được và tránh lỗi tràn bộ nhớ (Out-of-Memory) khi tác nhân duyệt web hoặc thực hiện biên dịch mã nguồn, chúng tôi đã loại bỏ cấu hình `e2-micro`. Cấu hình tối thiểu hiện tại là **`e2-small`** (2 vCPUs, 2GB RAM) với giá 100 credits ($1.00 USD) mỗi ngày.
                    </p>
                  </div>

                  <div className="border border-border rounded-xl p-4 bg-secondary/50">
                    <h4 className="font-bold mb-1.5">H: Cơ chế hoạt động của tích hợp Google Workspace bảo mật ra sao?</h4>
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      T: Chúng tôi yêu cầu quyền truy cập OAuth bảo mật, cô lập từ Tài khoản Google của bạn. Các mã thông báo (tokens) này được lưu trữ bằng CSFLE trong cơ sở dữ liệu và đồng bộ hóa trực tiếp vào máy ảo riêng của bạn. Công cụ `gog` CLI được cài sẵn sẽ sử dụng các mã này để thực thi công việc mà không truyền tải bất kỳ dữ liệu cá nhân nào về máy chủ trung tâm của Bihand.
                    </p>
                  </div>

                  <div className="border border-border rounded-xl p-4 bg-secondary/50">
                    <h4 className="font-bold mb-1.5">H: Tôi có thể chạy các mô hình tùy chỉnh trên tác nhân của mình không?</h4>
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      T: Có! Giao diện thành lập của chúng tôi hỗ trợ nhập mô hình thủ công. Chỉ cần chọn mục "Custom Model..." trong bảng phân vai trò, gõ tên mô hình bạn muốn sử dụng (ví dụ: `gemini-2.5-flash` hoặc `gpt-4o-mini`), và liên kết thông tin đăng nhập đã xác minh để bắt đầu.
                    </p>
                  </div>
                </div>
              </article>
            )
          )}
        </main>
      </div>
    </div>
  );
};

export default Terms;
