import React from 'react';
import { useLanguage } from '../context/LanguageContext';
import { PublicHeader } from '../components/public/PublicHeader';
import { Card } from '../components/ui/Card';

const Privacy: React.FC = () => {
  const { language } = useLanguage();

  return (
    <div className="min-h-screen bg-background text-foreground font-sans selection:bg-primary selection:text-primary-foreground">
      <PublicHeader cta="back" />

      <div className="max-w-4xl mx-auto px-6 py-12">
        <Card className="p-8 md:p-12">
          {language === 'en' ? (
            <article className="space-y-6 text-left leading-relaxed">
              <h1 className="text-3xl md:text-4xl font-bold tracking-tight">Privacy Policy</h1>
              <p className="text-muted-foreground text-sm">Last updated: June 6, 2026</p>

              <section className="space-y-3">
                <h2 className="text-xl font-semibold border-b border-border pb-2">1. Information We Collect</h2>
                <p className="text-sm text-foreground/90">
                  We only collect information necessary to operate, securely configure, and bill for autonomous AI worker VM clusters. This includes your contact registration details, linked third-party integration credentials (securely encrypted using explicit CSFLE), payment logs, and VM provisioning stdout logs.
                </p>
              </section>

              <section className="space-y-3">
                <h2 className="text-xl font-semibold border-b border-border pb-2">2. How Your Credentials Are Protected</h2>
                <p className="text-sm text-foreground/90">
                  Bihand employs advanced security controls to protect your data. All sensitive external API tokens are encrypted prior to transmission to our database nodes using MongoDB Client-Side Field Level Encryption (CSFLE) with dedicated AES-256-CBC envelope data encryption keys (DEKs). Our administrators, database providers, and cloud host operators cannot read or reconstruct your cleartext secrets.
                </p>
              </section>

              <section className="space-y-3">
                <h2 className="text-xl font-semibold border-b border-border pb-2">3. Google Workspace OAuth Token Handling</h2>
                <p className="text-sm text-foreground/90">
                  When you connect Google Workspace integrations to your agents, we request offline refresh tokens via OAuth. These tokens are used solely on your dedicated isolated GCP VM workspace to authorize the pre-installed `gog` CLI utility. We do not use, index, or store your actual email, drive files, or calendar contents on our centralized control plane.
                </p>
              </section>

              <section className="space-y-3">
                <h2 className="text-xl font-semibold border-b border-border pb-2">4. Data Sharing and Sandbox Isolation</h2>
                <p className="text-sm text-foreground/90">
                  We do not sell, distribute, or share your data or execution logs with third parties. Every AI company fleet is fully isolated on a hardware-level sandbox VM on GCP, ensuring complete data containment and protection across different organization tenants.
                </p>
              </section>
            </article>
          ) : (
            <article className="space-y-6 text-left leading-relaxed">
              <h1 className="text-3xl md:text-4xl font-bold tracking-tight">Chính Sách Bảo Mật</h1>
              <p className="text-muted-foreground text-sm">Cập nhật lần cuối: Ngày 6 tháng 6 năm 2026</p>

              <section className="space-y-3">
                <h2 className="text-xl font-semibold border-b border-border pb-2">1. Thông Tin Thu Thập</h2>
                <p className="text-sm text-foreground/90">
                  Chúng tôi chỉ thu thập các thông tin thực sự cần thiết nhằm vận hành, cấu hình bảo mật và thanh toán chi phí cho các cụm máy ảo tác nhân AI tự trị. Điều này bao gồm chi tiết đăng ký tài khoản của bạn, các thông tin tích hợp của bên thứ ba (được mã hóa bảo mật CSFLE), lịch sử nạp tiền và nhật ký khởi tạo máy ảo.
                </p>
              </section>

              <section className="space-y-3">
                <h2 className="text-xl font-semibold border-b border-border pb-2">2. Cơ Chế Bảo Vệ Thông Tin Đăng Nhập</h2>
                <p className="text-sm text-foreground/90">
                  Bihand sử dụng các biện pháp bảo mật nâng cao để bảo vệ dữ liệu của bạn. Tất cả khóa API nhạy cảm được mã hóa trước khi truyền đến cơ sở dữ liệu bằng cơ chế mã hóa phía khách của MongoDB (CSFLE) thông qua các khóa mã hóa dữ liệu độc lập (DEKs) AES-256-CBC. Quản trị viên, nhà cung cấp cơ sở dữ liệu và nhà quản lý máy chủ đám mây của chúng tôi hoàn toàn không thể xem hoặc giải mã các khóa này.
                </p>
              </section>

              <section className="space-y-3">
                <h2 className="text-xl font-semibold border-b border-border pb-2">3. Xử Lý Token Google Workspace OAuth</h2>
                <p className="text-sm text-foreground/90">
                  Khi bạn kết nối tích hợp Google Workspace với các tác nhân, chúng tôi yêu cầu mã làm mới ngoại tuyến (refresh token) thông qua cơ chế OAuth. Các mã thông báo này chỉ được sử dụng trực tiếp trên máy ảo GCP biệt lập của bạn để ủy quyền thực thi cho tiện ích `gog` CLI. Chúng tôi hoàn toàn không đọc, lập chỉ mục hoặc sao lưu nội dung email, tệp tin ổ đĩa hay sự kiện lịch của bạn trên máy chủ trung tâm.
                </p>
              </section>

              <section className="space-y-3">
                <h2 className="text-xl font-semibold border-b border-border pb-2">4. Chia Sẻ Dữ Liệu và Cô Lập Hộp Cát</h2>
                <p className="text-sm text-foreground/90">
                  Chúng tôi hoàn toàn không bán, phân phối hoặc chia sẻ dữ liệu và nhật ký hoạt động tác nhân của bạn cho bên thứ ba. Mỗi hạm đội công ty AI được cô lập hoàn toàn trên không gian phần cứng máy ảo riêng biệt trên GCP, đảm bảo an toàn và bảo mật dữ liệu tuyệt đối giữa các tổ chức khác nhau.
                </p>
              </section>
            </article>
          )}
        </Card>
      </div>
    </div>
  );
};

export default Privacy;
