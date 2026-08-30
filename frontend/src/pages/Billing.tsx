import React, { useEffect, useState } from 'react';
import { CreditCard, Loader2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import api from '../lib/api';
import { useLanguage } from '../context/LanguageContext';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { cn } from '../lib/cn';

const Billing: React.FC = () => {
  const { user, refreshToken } = useAuth();
  const { language } = useLanguage();
  const [selectedPackage, setSelectedPackage] = useState<string | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<'stripe' | 'momo' | 'vnpay'>('stripe');
  const [checkoutLoading, setCheckoutLoading] = useState(false);

  useEffect(() => {
    refreshToken();
  }, []);

  const handleBuyClick = (packageId: string) => {
    setSelectedPackage(packageId);
    setPaymentMethod('stripe');
  };

  const handleConfirmCheckout = async () => {
    if (!selectedPackage) return;
    setCheckoutLoading(true);
    try {
      const res = await api.post('/billing/checkout', {
        packageId: selectedPackage,
        paymentMethod
      });
      if (res.data.url) {
        window.location.href = res.data.url;
      }
    } catch (e) {
      alert("Checkout failed");
    } finally {
      setCheckoutLoading(false);
    }
  };

  const packages = [
    {
      id: 'tryout', label: 'TRY OUT', price: '$3.99', popular: false,
      desc: language === 'vi' ? '300 Lượt sử dụng\n(Duy trì 3 ngày e2-small)' : '300 Credits\n(3 days of e2-small)',
    },
    {
      id: 'starter', label: 'STARTER', price: '$29', popular: false,
      desc: language === 'vi' ? '3,000 Lượt sử dụng\nBao gồm 1 tháng thiết lập CEO' : '3,000 Credits\nIncludes 1 month CEO setup',
    },
    {
      id: 'pro', label: 'PRO', price: '$99', popular: true,
      desc: language === 'vi' ? '12,000 Lượt sử dụng\nBao gồm 4 tác nhân chạy đồng thời' : '12,000 Credits\nIncludes 4 concurrent agents',
    },
    {
      id: 'enterprise', label: 'ENTERPRISE', price: '$1,999', popular: false,
      desc: language === 'vi' ? '300,000 Lượt sử dụng\nBao gồm máy ảo tùy biến cam kết SLA' : '300,000 Credits\nIncludes custom SLA workspaces',
    },
  ];

  const paymentOptions: { id: 'stripe' | 'momo' | 'vnpay'; badge: string; name: string; desc: string; upcoming?: boolean; badgeColor: string }[] = [
    {
      id: 'stripe', badge: 'S', badgeColor: 'bg-white text-[#635BFF]', name: 'Stripe',
      desc: language === 'vi' ? 'Xử lý thanh toán thẻ Quốc tế (Visa/Mastercard) bảo mật' : 'Secure Credit/Debit card processing',
    },
    {
      id: 'momo', badge: 'M', badgeColor: 'bg-[#A50064] text-white', name: 'MoMo E-Wallet',
      desc: 'Ví điện tử MoMo Việt Nam', upcoming: true,
    },
    {
      id: 'vnpay', badge: 'V', badgeColor: 'bg-[#1C4E9C] text-white', name: 'VNPay QR',
      desc: 'Cổng VNPay quét mã QR & chuyển khoản nội địa', upcoming: true,
    },
  ];

  return (
    <div className="space-y-6 text-left">
      {/* Ledger header */}
      <Card className="relative overflow-hidden">
        <div className="absolute top-0 right-0 w-[300px] h-[200px] bg-purple-500/5 rounded-full blur-[90px] pointer-events-none" />
        <div className="absolute bottom-0 left-0 w-[200px] h-[150px] bg-emerald-500/5 rounded-full blur-[80px] pointer-events-none" />

        <div>
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-purple-500 shadow-[0_0_10px_rgba(168,85,247,0.5)] animate-pulse" />
            <h1 className="text-xl font-bold font-mono tracking-widest uppercase">
              {language === 'vi' ? 'Sổ cái Tài chính & Chi phí' : 'Financial Ledger & Usage'}
            </h1>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            {language === 'vi'
              ? 'Nạp và quản lý số dư tín dụng máy ảo đám mây của bạn. Tín dụng được tiêu hao hằng ngày dựa trên cấu hình máy ảo hạm đội và thời gian thực thi.'
              : 'Acquire and manage cloud computing balance credits. Credits are depleted daily depending on active VM machine profiles and execution runtimes.'}
          </p>
        </div>
      </Card>

      <Card className="hover:border-purple-500/20 flex justify-between items-center relative overflow-hidden group transition-all p-8">
        <div className="absolute top-0 left-0 right-0 h-[2px] bg-purple-500/10 group-hover:bg-purple-500/30 transition-colors" />
        <div>
          <div className="text-[10px] font-bold font-mono text-muted-foreground uppercase tracking-wider mb-2">
            {language === 'vi' ? 'Số dư Tín dụng Hiện có' : 'Available Compute Balance'}
          </div>
          <div className="text-4xl font-extrabold tracking-tight font-mono">
            {user?.credits || '0'} <span className="text-lg text-muted-foreground font-semibold font-sans">Credits</span>
          </div>
        </div>
        <CreditCard size={64} className="text-purple-500 opacity-10 group-hover:opacity-20 transition-opacity" />
      </Card>

      <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground font-mono pt-4">
        {language === 'vi' ? 'Nạp thêm số dư tín dụng' : 'Acquire Compute Balance'}
      </h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        {packages.map((pkg) => (
          <Card
            key={pkg.id}
            className={cn(
              'transition-all duration-200 group relative flex flex-col justify-between overflow-hidden',
              pkg.popular ? 'border-purple-500/40 hover:shadow-[0_0_25px_rgba(168,85,247,0.04)]' : 'hover:border-purple-500/20 hover:shadow-[0_0_20px_rgba(168,85,247,0.02)]'
            )}
          >
            {pkg.popular && (
              <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-purple-500 text-white text-[9px] font-extrabold px-3 py-1 rounded-full uppercase tracking-widest shadow-lg shadow-purple-500/20">
                {language === 'vi' ? 'Phổ biến' : 'Popular'}
              </div>
            )}
            <div className={cn('absolute top-0 left-0 right-0 h-[2px] transition-colors', pkg.popular ? 'bg-purple-500/40' : 'bg-purple-500/5 group-hover:bg-purple-500/30')} />
            <div className={cn('text-center', pkg.popular && 'pt-2')}>
              <div className={cn('text-[10px] font-bold font-mono uppercase mb-2', pkg.popular ? 'text-purple-500' : 'text-muted-foreground')}>{pkg.label}</div>
              <div className="text-3xl font-extrabold font-mono mb-4">{pkg.price}</div>
              <div className="text-xs text-muted-foreground leading-relaxed font-sans font-medium mb-6 whitespace-pre-line">
                {pkg.desc}
              </div>
            </div>
            <Button
              onClick={() => handleBuyClick(pkg.id)}
              variant={pkg.popular ? 'primary' : 'outline'}
              className={cn('w-full uppercase tracking-wider', pkg.popular && 'bg-purple-500 hover:bg-purple-400 shadow-md shadow-purple-500/10')}
            >
              {language === 'vi' ? 'Mua ngay' : 'Buy Now'}
            </Button>
          </Card>
        ))}
      </div>

      {/* Payment Selection Modal */}
      <Modal
        open={!!selectedPackage}
        onClose={() => setSelectedPackage(null)}
        title={language === 'vi' ? 'Chọn Phương thức Thanh toán' : 'Select Payment Method'}
      >
        {selectedPackage && (
          <div className="space-y-4 text-sm">
            <p className="text-xs text-muted-foreground leading-relaxed">
              {language === 'vi'
                ? `Xác nhận giao dịch thanh toán cho gói tín dụng ${selectedPackage.toUpperCase()}.`
                : `Confirm your checkout strategy for the ${selectedPackage.toUpperCase()} package.`}
            </p>

            <div className="space-y-3 pt-2">
              {paymentOptions.map((opt) => (
                <label
                  key={opt.id}
                  className={cn(
                    'flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-all',
                    paymentMethod === opt.id ? 'border-foreground bg-secondary' : cn('border-border hover:border-muted-foreground', opt.upcoming && 'opacity-60')
                  )}
                  onClick={() => setPaymentMethod(opt.id)}
                >
                  <div className="flex items-center gap-3">
                    <div className={cn('w-8 h-8 rounded flex items-center justify-center font-bold text-xs', opt.badgeColor)}>{opt.badge}</div>
                    <div>
                      <div className="font-semibold text-foreground">
                        {opt.name}
                        {opt.upcoming && (
                          <span className="text-[9px] bg-secondary text-pink-500 px-1 py-0.5 rounded ml-1">
                            {language === 'vi' ? 'Sắp ra mắt' : 'Upcoming'}
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-muted-foreground">{opt.desc}</div>
                    </div>
                  </div>
                  <input type="radio" checked={paymentMethod === opt.id} readOnly className="accent-foreground" />
                </label>
              ))}
            </div>

            <div className="flex justify-end gap-3 pt-4 border-t border-border mt-6">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setSelectedPackage(null)}
              >
                {language === 'vi' ? 'Hủy bỏ' : 'Cancel'}
              </Button>
              <Button
                onClick={handleConfirmCheckout}
                disabled={checkoutLoading}
              >
                {checkoutLoading ? <Loader2 size={14} className="animate-spin" /> : null}
                {language === 'vi' ? 'Tiếp tục Thanh toán' : 'Proceed to Pay'}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};

export default Billing;
