import React from 'react';
import { useNavigate } from 'react-router-dom';
import { BookOpen, ShieldCheck, CreditCard, HelpCircle, Lock } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';

const legalLinks = (language: 'en' | 'vi') => [
  { icon: BookOpen, label: language === 'en' ? 'General Terms' : 'Điều khoản chung', to: '/terms#terms' },
  { icon: ShieldCheck, label: language === 'en' ? 'Terms of Use' : 'Điều khoản giao dịch', to: '/terms#usage' },
  { icon: CreditCard, label: language === 'en' ? 'Payment Policy' : 'Chính sách thanh toán', to: '/terms#payment' },
  { icon: HelpCircle, label: language === 'en' ? 'FAQs' : 'Câu hỏi thường gặp', to: '/terms#faq' },
  { icon: Lock, label: language === 'en' ? 'Privacy Policy' : 'Chính sách bảo mật', to: '/privacy' },
];

/**
 * evose.ai-style dark footer band. Deliberately theme-invariant (always dark, like the
 * reference site's footer) rather than driven by the light/dark tokens.
 */
export const PublicFooter: React.FC = () => {
  const navigate = useNavigate();
  const { language, t } = useLanguage();

  return (
    <footer className="bg-zinc-950 text-zinc-300 py-16">
      <div className="max-w-6xl mx-auto px-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-10 mb-10">
          <div className="space-y-3 md:col-span-1">
            <h4 className="font-semibold text-white">Bihand Platform</h4>
            <p className="text-xs leading-relaxed text-zinc-400">
              {language === 'en'
                ? 'High-availability cloud infrastructure for fleets of autonomous AI agents. Powering isolated, secure agent workloads at scale.'
                : 'Hạ tầng đám mây độ tin cậy cao cho các hạm đội tác nhân AI tự trị. Vận hành an toàn khối lượng công việc của tác nhân ở quy mô lớn.'}
            </p>
          </div>
          <div className="space-y-2 md:col-span-2 text-xs leading-relaxed text-zinc-400">
            <h4 className="font-semibold text-white">{language === 'en' ? 'Corporate Information' : 'Thông tin doanh nghiệp'}</h4>
            <p className="font-semibold text-zinc-200">
              {language === 'en' ? 'GRAPHICSMINER VIETNAM COMPANY LIMITED' : 'CÔNG TY TNHH GRAPHICSMINER VIETNAM'}
            </p>
            <p>{language === 'en'
              ? 'Business Registration Certificate: 0315212350 first issued on August 9, 2018 by Ho Chi Minh City Department of Planning and Investment.'
              : 'Giấy Chứng nhận đăng ký doanh nghiệp: 0315212350 đăng ký lần đầu ngày 09/08/2018, được cấp bởi Sở Kế hoạch và Đầu tư Thành phố Hồ Chí Minh.'}</p>
            <p>{language === 'en'
              ? 'Address: 220/25 Thong Nhat Street, Go Vap District, Ho Chi Minh City, Vietnam'
              : 'Địa chỉ: 220/25 Thống Nhất, Phường Gò Vấp, Thành phố Hồ Chí Minh, Việt Nam'}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-10">
          {legalLinks(language).map(({ icon: Icon, label, to }) => (
            <button
              key={to}
              onClick={() => navigate(to)}
              className="flex items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900/60 px-4 py-3 text-sm text-zinc-300 hover:bg-zinc-800 hover:text-white transition-colors text-left"
            >
              <Icon size={16} className="shrink-0" />
              {label}
            </button>
          ))}
        </div>

        <div className="border-t border-zinc-800 pt-6 text-center text-xs text-zinc-500">
          {t('landing.footer')}
        </div>
      </div>
    </footer>
  );
};

export default PublicFooter;
